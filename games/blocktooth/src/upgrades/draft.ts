// BLOCKTOOTH — 3-card upgrade drafts (CONTRACT §5.3, §11). Lane: upgrades.
// THREE-FREE, DOM-free, deterministic (rng.loot only).
//
//   * Eligible = titan filter (generic or this titan's cards), minRank ≤ titan.rank, not maxed.
//   * Rarity roll per card slot: RARITY_BASE[r] × (1 + luck·RARITY_LUCK[r]) — 60/28/10/2 (a per-slot
//     percentage split at luck 0) × (1 + luck·[0, .5, 1, 1.5]); rarities with no eligible card left
//     drop out and the rest renormalise; then a uniform card of that rarity. Implemented as ONE
//     rng.loot draw per slot over per-card weights rarityWeight(r) / (cards of rarity r still in the
//     pool) — identical distribution, so the rarity shares do not depend on how many cards of each
//     rarity the catalogue happens to hold.
//   * Offer = 3 DISTINCT ids, sampling without replacement on rng.loot.
//   * Chest drafts (elite chests): rare+ only; if fewer than 3 rare+ cards remain, the offer is
//     topped up from commons rather than shown short. A pool thinner than 3 yields fewer cards,
//     an empty pool yields none (and hasPendingDraft() reports false so the app never blocks).
//   * A new draft refills upgrades.rerolls to floor(rerolls stat); rerollOffer spends one and
//     avoids re-showing the current three whenever enough other cards exist.

import type { Rarity, UpgradeDef, World } from '../core/types.ts';
import { UPGRADES, UPGRADE_BY_ID } from '../data/upgrades.ts';
import { stat } from './stats.ts';
import { applyUpgrade } from './engine.ts';

export const RARITY_BASE: Record<Rarity, number> = { common: 60, rare: 28, epic: 10, legendary: 2 };
export const RARITY_LUCK: Record<Rarity, number> = { common: 0, rare: 0.5, epic: 1, legendary: 1.5 };
export const OFFER_SIZE = 3;

/** Weight of a rarity at a luck value (never negative; a cursed-luck run still sees rares). */
export function rarityWeight(r: Rarity, luck: number): number {
  return RARITY_BASE[r] * Math.max(0.1, 1 + luck * RARITY_LUCK[r]);
}

/** Is this card offerable to this world right now (ignoring the chest rarity rule)? */
export function isEligible(w: World, u: UpgradeDef): boolean {
  if (u.titan && u.titan !== w.titanId) return false;
  if ((u.minRank ?? 0) > w.titan.rank) return false;
  return (w.upgrades.owned[u.id] ?? 0) < u.maxStacks;
}

// which counter the live offer will consume (chest vs level-up), per UpgradeState
const OFFER_IS_CHEST = new WeakMap<object, boolean>();
const POOL: UpgradeDef[] = [];
const WTS: number[] = [];

function buildPool(w: World, chest: boolean, exclude: readonly string[] | null): void {
  POOL.length = 0;
  for (const u of UPGRADES) {
    if (!isEligible(w, u)) continue;
    if (chest && u.rarity === 'common') continue;
    if (exclude && exclude.includes(u.id)) continue;
    POOL.push(u);
  }
}

const CNT: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };

/** Rarity-first sampling without replacement of up to `k` cards from POOL (one rng.loot draw per card). */
function sample(w: World, k: number, out: string[]): void {
  const luck = stat(w, 'luck');
  let n = POOL.length;
  WTS.length = n;
  while (out.length < k && n > 0) {
    CNT.common = 0; CNT.rare = 0; CNT.epic = 0; CNT.legendary = 0;
    for (let i = 0; i < n; i++) CNT[POOL[i].rarity]++;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = POOL[i].rarity;
      WTS[i] = rarityWeight(r, luck) / CNT[r];
      total += WTS[i];
    }
    let x = w.rng.loot() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { x -= WTS[i]; if (x < 0) { pick = i; break; } }
    out.push(POOL[pick].id);
    // remove by shifting (keeps the remaining order = catalogue order → stable determinism)
    for (let i = pick; i < n - 1; i++) POOL[i] = POOL[i + 1];
    n--;
    POOL.length = n;
  }
}

function roll(w: World, chest: boolean, avoid: readonly string[] | null): string[] {
  const out: string[] = [];
  // 1) the proper pool (optionally avoiding the current offer when there is enough else to show)
  if (avoid) {
    buildPool(w, chest, avoid);
    if (POOL.length < OFFER_SIZE) buildPool(w, chest, null);
  } else {
    buildPool(w, chest, null);
  }
  sample(w, OFFER_SIZE, out);
  // 2) chest pool too thin → top up from commons (still eligible, still distinct)
  if (chest && out.length < OFFER_SIZE) {
    buildPool(w, false, out);
    sample(w, OFFER_SIZE, out);
  }
  return out;
}

/**
 * Roll (or return the still-open) 3-card offer. A NEW draft refills upgrades.rerolls from the
 * rerolls stat. Deterministic: consumes only rng.loot. Sets upgrades.offer.
 * `chest` omitted → it is a chest draft exactly when no level-up draft is owed but a chest is
 * (level-up drafts are served first).
 */
export function rollOffer(w: World, chest?: boolean): string[] {
  const U = w.upgrades;
  if (U.offer && U.offer.length > 0) return U.offer;   // re-opening the draft never re-rolls it
  if (chest === undefined) chest = U.pendingDrafts <= 0 && U.chestDrafts > 0;
  const ids = roll(w, chest, null);
  U.rerolls = Math.max(0, Math.floor(stat(w, 'rerolls')));
  U.offer = ids.length > 0 ? ids : null;
  OFFER_IS_CHEST.set(U, chest);
  return ids;
}

/** Spend one reroll on a fresh offer of the same kind. null when no reroll or no open offer. */
export function rerollOffer(w: World): string[] | null {
  const U = w.upgrades;
  if (!U.offer || U.offer.length === 0 || U.rerolls <= 0) return null;
  const chest = OFFER_IS_CHEST.get(U) ?? (U.chestDrafts > 0 && U.pendingDrafts === 0);
  U.rerolls -= 1;
  const ids = roll(w, chest, U.offer);
  U.offer = ids.length > 0 ? ids : null;
  return ids;
}

/**
 * Take a card: apply it, consume one pending draft (chest or level-up), clear the offer.
 * An id that could not be applied (unknown, another titan's, already maxed) is ignored and consumes
 * nothing, so a stale UI click can never burn a draft on a no-op.
 */
export function pickUpgrade(w: World, id: string): void {
  const U = w.upgrades;
  const u = UPGRADE_BY_ID[id];
  if (!u) return;
  const inOffer = !!U.offer && U.offer.includes(id);
  if (!inOffer && !isEligible(w, u)) return;
  const before = U.owned[id] ?? 0;
  applyUpgrade(w, id);
  if ((U.owned[id] ?? 0) === before) {                 // nothing applied (maxed / other titan)
    if (inOffer) { U.offer = null; OFFER_IS_CHEST.delete(U); }   // stale offer: next rollOffer re-rolls it
    return;
  }
  const known = OFFER_IS_CHEST.get(U);
  const chest = known ?? (U.chestDrafts > 0);
  if (chest && U.chestDrafts > 0) U.chestDrafts -= 1;
  else if (U.pendingDrafts > 0) U.pendingDrafts -= 1;
  else if (U.chestDrafts > 0) U.chestDrafts -= 1;
  U.offer = null;
  OFFER_IS_CHEST.delete(U);
}

/** A draft is owed AND at least one card can still be offered. */
export function hasPendingDraft(w: World): boolean {
  const U = w.upgrades;
  if (U.pendingDrafts <= 0 && U.chestDrafts <= 0) return false;
  if (U.offer && U.offer.length > 0) return true;
  for (const u of UPGRADES) if (isEligible(w, u)) return true;
  return false;
}
