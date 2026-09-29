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
import { isOverflowReward, recipeHint } from '../src/upgrades/draft.ts';

/** Score that makes the bot take an offered evolution over any ordinary card. */
export const BOT_EVO_SCORE = 1000;
/** F1: bonus for a card that advances a started recipe / that makes it ready. */
export const BOT_RECIPE_TOWARD = 14;
export const BOT_RECIPE_COMPLETES = 30;

/** TITAN PASS D1 OVERFLOW rewards (upgrades/draft.ts OVERFLOW): what a player weighs them at. SICK DAY is worth
 *  BOT_OVF_HEAL × the missing HP share (at half HP it beats any ordinary card; near full it is the last pick);
 *  HOT TIP (UPROAR not ready) / HARD HAT (no shield up) sit under an ordinary owned card (generic scores ≈ 1.5–10),
 *  so a real upgrade is taken whenever one is offered and the rewards pay out when nothing better is on the table. */
export const BOT_OVF_HEAL = 40;
export const BOT_OVF_UPROAR = 0.8;
export const BOT_OVF_SHIELD = 0.6;

export function botDraftScore(w: World, id: string): number | null {
  if (isOverflowReward(id)) {
    const T = w.titan;
    if (id === 'ovf_sick_day') return BOT_OVF_HEAL * (T.maxHp > 0 ? Math.max(0, 1 - T.hp / T.maxHp) : 0);
    if (id === 'ovf_hot_tip') return w.ult && w.ult.ready ? 0 : BOT_OVF_UPROAR;
    return w.upgrades.shield > 0 ? 0.1 : BOT_OVF_SHIELD;
  }
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
