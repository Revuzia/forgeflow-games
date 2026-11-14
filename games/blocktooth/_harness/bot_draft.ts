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
import { SLOT_CAP, cardSlot, isOverflowReward, recipeHint, slotsUsed } from '../src/upgrades/draft.ts';

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

/** F1: extra score for a card that advances a started evolution recipe (0 otherwise), plus the BUILD SLOTS read
 *  (botSlotBonus) — bot.ts adds this on top of its generic card score. */
export function botRecipeBonus(w: World, id: string): number {
  const h = recipeHint(w, id);
  const r = !h ? 0 : h.completes ? BOT_RECIPE_COMPLETES : BOT_RECIPE_TOWARD;
  return r + botSlotBonus(w, id);
}

// ─────────────── BUILD SLOTS read (TITAN PASS D1; lane BAL) ───────────────
// The draft card says "NEW - TAKES A SLOT (n/8)" / "UPGRADE" / "ONE-OFF". A person reading that treats a slot as an
// investment: the early slots go to the cards that scale the run (the titan's own kit, damage, growth — and a growth
// card is worth a little more while slots are open, because it is what gets the titan to Size IV on time), a flat
// mobility / hook / UPROAR card is a poor use of one of eight slots unless nothing better is on the table, a shallow
// card (few stacks) fills a slot with little power, and once the slots run short an upgrade of a held card beats
// opening a new one. Survival / defense cards are NOT marked down: a person keeps a way to stay alive, and a draft
// that shunned them (the first BAL cut) cost the player-like set ~5 of 96 clears (probe_balance P-human 83 -> 78).
// Pre-BAL the bot scored every card as if slots did not exist and filled all eight by LV 10-13
// (hearthback/grideast/99: four survival cards; molo/whitestacks/99: long_arm_statute, second_opinion, carpool_permit),
// then paid overflow rewards for 20 levels and missed LV 35 by the city-boss time cap (probe_gatekeepers case 1 / 10;
// gate-bot fresh matrix: 2 caps -> 0, LV 35 median 486 -> 481 s, max 619 -> 529 s).
// Adjustments are added to the generic score (typical ordinary cards 2-20). ONE-OFF ('free'), 'shared' (the missing
// half of a started recipe) and evolutions take no slot and are left alone.
/** Early-slot bonus for a NEW card whose first tag is a scaling tag, while at least SLOT_EARLY_FREE slots are open. */
export const BOT_SLOT_CORE = 3;
export const BOT_SLOT_EARLY_FREE = 3;
/** Extra early-slot bonus for a NEW card carrying the 'growth' tag anywhere (same SLOT_EARLY_FREE condition). */
export const BOT_SLOT_GROWTH = 2;
/** Penalty for a NEW flat card (first tag mobility / hook / ult): base + per used slot. */
export const BOT_SLOT_FLAT_BASE = 3;
export const BOT_SLOT_FLAT_PER_USED = 0.5;
/** Penalty per missing stack below 4 (a 2-stack card fills a slot with 2 levels of power). */
export const BOT_SLOT_SHALLOW = 1;
/** With ≤ SCARCE_FREE slots open: a NEW card pays this, a held card's UPGRADE earns BOT_SLOT_UPGRADE. */
export const BOT_SLOT_SCARCE_FREE = 2;
export const BOT_SLOT_SCARCE = 4;
export const BOT_SLOT_UPGRADE = 2;
const CORE_TAGS: ReadonlySet<string> = new Set(['kit', 'offense', 'growth', 'smash']);
const FLAT_TAGS: ReadonlySet<string> = new Set(['mobility', 'hook', 'ult']);

/** The slot-aware part of a card's value (0 for anything that is not an ordinary card). */
export function botSlotBonus(w: World, id: string): number {
  if (isOverflowReward(id)) return 0;
  const u = UPGRADE_BY_ID[id];
  if (!u || u.evo || u.perk) return 0;
  const tag = cardSlot(w, id);
  const used = slotsUsed(w);
  const free = SLOT_CAP - used;
  if (tag === 'upgrade') return free <= BOT_SLOT_SCARCE_FREE ? BOT_SLOT_UPGRADE : 0;
  if (tag !== 'new') return 0;
  const first = u.tags[0] ?? '';
  let b = 0;
  if (CORE_TAGS.has(first) && free >= BOT_SLOT_EARLY_FREE) b += BOT_SLOT_CORE;
  if (FLAT_TAGS.has(first)) b -= BOT_SLOT_FLAT_BASE + BOT_SLOT_FLAT_PER_USED * used;
  if (u.tags.includes('growth') && free >= BOT_SLOT_EARLY_FREE) b += BOT_SLOT_GROWTH;
  b -= BOT_SLOT_SHALLOW * Math.max(0, 4 - u.maxStacks);
  if (free <= BOT_SLOT_SCARCE_FREE) b -= BOT_SLOT_SCARCE;
  return b;
}
