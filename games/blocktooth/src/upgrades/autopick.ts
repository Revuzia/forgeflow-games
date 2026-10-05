// BLOCKTOOTH — the in-sim draft scorer (lane B-TITAN, online VS). THREE-free, DOM-free, deterministic (no rng, no clocks).
//
// A faithful PORT of the harness policy `_harness/bot.ts botScoreUpgrade / botPickUpgrade` + `_harness/bot_draft.ts`
// (botDraftScore, botRecipeBonus, botSlotBonus), so the SIM can pick a card by itself: the CARD RAIL's 12 s auto-pick
// (vs_design.md §7: "it picks the bot's choice, deterministic") and the VS bot seats' draft picks. The harness copies
// stay as they are (GATE 2 / every solo probe still drives them); `probe_rail.ts` checks this port scores identically
// to them over real offers, so a drift in either is caught.
//
// Same numbers, same tie rule (first in offer order wins). Bound player: reads w.titan / w.upgrades / w.ult.

import type { StatKey, UpgradeDef, World } from '../core/types.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';
import { SLOT_CAP, cardSlot, isOverflowReward, recipeHint, slotsUsed } from './draft.ts';

// ─────────────────────────────── bot_draft.ts constants ───────────────────────────────
const EVO_SCORE = 1000;
const RECIPE_TOWARD = 14;
const RECIPE_COMPLETES = 30;
const OVF_HEAL = 40;
const OVF_UPROAR = 0.8;
const OVF_SHIELD = 0.6;
const SLOT_CORE = 3;
const SLOT_EARLY_FREE = 3;
const SLOT_GROWTH = 2;
const SLOT_FLAT_BASE = 3;
const SLOT_FLAT_PER_USED = 0.5;
const SLOT_SHALLOW = 1;
const SLOT_SCARCE_FREE = 2;
const SLOT_SCARCE = 4;
const SLOT_UPGRADE = 2;
const CORE_TAGS: ReadonlySet<string> = new Set(['kit', 'offense', 'growth', 'smash']);
const FLAT_TAGS: ReadonlySet<string> = new Set(['mobility', 'hook', 'ult']);

// ─────────────────────────────── bot.ts constants ───────────────────────────────
const STAT_W: Partial<Record<StatKey, number>> = {
  damage: 3.0, attackRate: 2.6, area: 2.4, massGain: 2.6, xpGain: 2.0, smashDamage: 1.8,
  buildingDamage: 1.6, smashRadius: 1.4, maxHp: 1.6, armor: 1.3, regen: 1.0, lifesteal: 1.2,
  moveSpeed: 1.5, pickupRadius: 1.2, critChance: 1.4, critMult: 1.0, attackRange: 1.6,
  abilityPower: 1.4, abilityCooldown: 1.4, chains: 1.4, projectiles: 1.4, arcForks: 1.3,
  wireDamage: 1.3, wireDuration: 1.0, shellCapacity: 1.2, stompDelay: 1.0, magmaDuration: 1.1,
  turretCap: 1.2, turretRate: 1.2, sporeHeal: 0.9, vineLength: 1.3, biteCleave: 1.2,
  pulseEvery: 1.0, vacuumRadius: 1.0, dashCharges: 1.0, dashCooldown: 0.9, dashDistance: 0.8,
  luck: 0.7, rerolls: 0.5, iframes: 0.8, thorns: 0.8, rubbleHeal: 1.0, knockback: 0.4,
  chainRange: 0.9, sparkChance: 1.2,
};
const LOWER_IS_BETTER: ReadonlySet<StatKey> = new Set<StatKey>(['abilityCooldown', 'dashCooldown', 'pulseEvery', 'stompDelay']);
const NORM: Partial<Record<StatKey, number>> = {
  armor: 40, iframes: 0.3, thorns: 10, lifesteal: 0.05, rubbleHeal: 1, luck: 1, chains: 1,
  projectiles: 1, sparkChance: 0.2, biteCleave: 1, magmaDuration: 2, critChance: 0.2, rerolls: 1,
  dashCharges: 1, pulseEvery: 4, turretCap: 4, arcForks: 3,
};
const TAG_BONUS: Record<string, number> = { offense: 1.5, growth: 1.5, smash: 1.0, hook: 0.5, defense: 0.5, survival: 0.5 };
const RARITY_BONUS: Record<string, number> = { common: 0, rare: 1, epic: 2, legendary: 3 };

/** bot_draft.ts botDraftScore: evolutions and OVERFLOW rewards; null = "no opinion" (the generic formula scores it). */
function draftScore(w: World, id: string): number | null {
  if (isOverflowReward(id)) {
    const T = w.titan;
    if (id === 'ovf_sick_day') return OVF_HEAL * (T.maxHp > 0 ? Math.max(0, 1 - T.hp / T.maxHp) : 0);
    if (id === 'ovf_hot_tip') return w.ult && w.ult.ready ? 0 : OVF_UPROAR;
    return w.upgrades.shield > 0 ? 0.1 : OVF_SHIELD;
  }
  const u = UPGRADE_BY_ID[id];
  if (!u) return null;
  if (u.evo) {
    if ((w.upgrades.owned[id] ?? 0) > 0 || (u.titan && u.titan !== w.titanId)) return -1e9;
    return EVO_SCORE;
  }
  return null;
}

/** bot_draft.ts botSlotBonus. */
function slotBonus(w: World, id: string): number {
  if (isOverflowReward(id)) return 0;
  const u = UPGRADE_BY_ID[id];
  if (!u || u.evo || u.perk) return 0;
  const tag = cardSlot(w, id);
  const used = slotsUsed(w);
  const free = SLOT_CAP - used;
  if (tag === 'upgrade') return free <= SLOT_SCARCE_FREE ? SLOT_UPGRADE : 0;
  if (tag !== 'new') return 0;
  const first = u.tags[0] ?? '';
  let b = 0;
  if (CORE_TAGS.has(first) && free >= SLOT_EARLY_FREE) b += SLOT_CORE;
  if (FLAT_TAGS.has(first)) b -= SLOT_FLAT_BASE + SLOT_FLAT_PER_USED * used;
  if (u.tags.includes('growth') && free >= SLOT_EARLY_FREE) b += SLOT_GROWTH;
  b -= SLOT_SHALLOW * Math.max(0, 4 - u.maxStacks);
  if (free <= SLOT_SCARCE_FREE) b -= SLOT_SCARCE;
  return b;
}

/** bot_draft.ts botRecipeBonus. */
function recipeBonus(w: World, id: string): number {
  const h = recipeHint(w, id);
  const r = !h ? 0 : h.completes ? RECIPE_COMPLETES : RECIPE_TOWARD;
  return r + slotBonus(w, id);
}

/** Deterministic value of taking card `id` now (higher = better) — bot.ts botScoreUpgrade, ported. */
export function autoPickScore(w: World, id: string): number {
  if (id.startsWith('ovf_')) {
    const hpFrac = w.titan.maxHp > 0 ? w.titan.hp / w.titan.maxHp : 1;
    if (id === 'ovf_sick_day') return hpFrac < 0.7 ? 3 : 0;
    if (id === 'ovf_hard_hat') return 1.5;
    if (id === 'ovf_hot_tip') return 1;
    return 0.5;
  }
  const v2 = draftScore(w, id);
  if (v2 !== null) return v2;
  const def: UpgradeDef | undefined = (UPGRADE_BY_ID as Record<string, UpgradeDef | undefined>)[id];
  if (!def) return -1e9;
  const stats = w.titan.stats;
  let s = 0;
  for (const e of def.effects) {
    if (e.stat) {
      const wt = STAT_W[e.stat] ?? 0.8;
      const base = Math.abs(stats[e.stat] ?? 0);
      const nrm = NORM[e.stat] ?? Math.max(base, 1);
      let mag = 0;
      if (e.add) mag += e.add / nrm;
      if (e.mul) mag += e.mul;
      if (LOWER_IS_BETTER.has(e.stat)) mag = -mag;
      s += wt * mag * 10;
    }
    if (e.trigger) s += 3 + Math.min(1, e.trigger.chance) * 2;
  }
  for (const t of def.tags) s += TAG_BONUS[t] ?? 0;
  s += RARITY_BONUS[def.rarity] ?? 0;
  if (def.titan && def.titan === w.titanId) s += 1.5;
  const owned = w.upgrades.owned[id] ?? 0;
  return s / (1 + 0.1 * owned) + recipeBonus(w, id);
}

/** Pick one card from an offer for the BOUND player (first in offer order wins ties) — bot.ts botPickUpgrade. */
export function autoPickCard(w: World, offer: readonly string[]): string {
  let best = offer[0], bestS = -Infinity;
  for (const id of offer) {
    const s = autoPickScore(w, id);
    if (s > bestS) { bestS = s; best = id; }
  }
  return best;
}

/** 1-based index of the card autoPickCard would take (what a bot writes into `TitanInput.railPick`); 0 for an empty offer. */
export function autoPickIndex(w: World, offer: readonly string[]): number {
  if (offer.length === 0) return 0;
  return offer.indexOf(autoPickCard(w, offer)) + 1;
}
