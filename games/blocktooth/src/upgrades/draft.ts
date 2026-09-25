// BLOCKTOOTH — 3-card upgrade drafts (CONTRACT §5.3, §11; v2: FEATURES_V2 §7). Lanes: upgrades, L2.
// THREE-FREE, DOM-free, deterministic (rng.loot only).
//
//   * Eligible = titan filter (generic or this titan's cards), minRank ≤ titan.rank, not maxed.
//     v2 (§7.1): evolutions and perk cards are never rolled; a `locked` card needs w.meta.unlocked; a
//     banished card is out for the run; a base card whose evolution is owned never comes back.
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
//
// v2 (FEATURES_V2 §7.3–§7.5; slots are 0-based everywhere):
//   * rollOffer: base offer rolled EXACTLY as before (same rng.loot draws) → LOCK: the held card (if still
//     eligible) takes slot 0 and the card rolled there goes back; a duplicate of it in slot 1/2 is
//     re-rolled once (same kind, excluding every offered id; nothing left → the slot is dropped) →
//     EVOLUTION (only when evolutionsReady is non-empty): chest → first ready evo into slot 0 (slot 1
//     behind a held card), no draw; level-up → ONE extra rng.loot draw, < DRAFT_V2.evoDraftChance →
//     first ready evo replaces slot 2. No evo ready and nothing held → the loot stream is untouched.
//   * rerollOffer: a held card keeps its slot, only the other slots re-roll (held id excluded);
//     tally.rerolls++.
//   * banishCard: the slot is refilled in place with ONE roll of the same kind avoiding the other offered
//     ids (rng.loot); empty refill → the offer shrinks; the last card of a 1-card offer is refused.
//     Banishing the held card clears the hold and refunds its charge. tally.banishes++.
//   * lockCard: toggle. Setting spends a charge (lockLeft > 0 needed); unlocking refunds it; locking
//     another card moves the hold (no refund, no extra charge). tally.locks counts charges in use.
//   * pickUpgrade: an evolution deletes owned[base] and takes the base's place in `order`;
//     tally.evolutions++. Picking the held card clears the hold (no extra charge).
//   * A held card that is an evolution stays deliverable while its recipe is still ready.
//   * An evolution sitting in an offer is NOT carried through a reroll (the spec keeps only the held slot);
//     it stays ready and returns on a later draft.
//
// Measured (L2, 2026-09-24, working tree = HEAD 5731402c + C0 skeleton + in-flight C1 lanes; seed 1337):
//   | knob / fact                      | value | measurement                                                          |
//   |----------------------------------|-------|----------------------------------------------------------------------|
//   | DRAFT_V2.evoDraftChance          | 0.2   | probe_evolutions: evo offered in 105/600 level-up drafts (17.5 %)    |
//   | DRAFT_V2.banishes / locks        | 2 / 2 | unchanged; the gate bot never banishes or locks                     |
//   | evolutions in GATE 2 (bot)       | 0     | 0 in 12 fresh + 12 full-unlock runs: the bot spreads picks and never |
//   |                                  |       | maxes a recipe base — GATE 2 does not see the evolution power spike  |
//   | reachability, recipe-chasing play| ~50 % | probe_evolutions §10: ≥1 evo in 59–65/120 runs, median first at      |
//   |                                  |       | draft 35–37 of 42 (late Size IV/V); a non-chasing picker: 0/120      |
//   | GATE 2 fresh / full (forced)     | PASS  | 9/12 and 10/12 clears, Size II worst 130 s / 133 s (band ≤ 150)      |
//
// F1 (2026-09-25, critic HIGH / owner item 8: evolutions basically never appeared — the base had to be MAXED out
// of a ~200-card pool; the table above is the pre-F1 state). Rule changes, all in this file + data/evolutions.ts:
//   * READY at owned[base] ≥ min(EVO_READY_STACKS = 3, base maxStacks) + companion owned (was: base maxed).
//     probe_evolutions: every recipe readied at exactly that threshold still ends ≥ the MAXED base on every stat.
//   * DRAFT NUDGE (recipeNudge): the MISSING HALF of a started recipe (companion once the base is owned; base
//     below its ready stacks once the companion is owned) rolls with EVO_NUDGE = 10 × its weight inside its
//     rarity. Rarity split and rng.loot draw count unchanged (probe_evolutions §1b). A base never nudges itself.
//   * Chest drafts already put a ready evolution in slot 0 (unchanged); level-up drafts keep evoDraftChance.
//   * recipeHint / evolutionProgress: read-only hint API for the draft UI (TOWARD / COMPLETES <EVO>, READY rows).
//   Measured with the GATE 2 bot (bot_draft.ts: takes a ready evo; +14 for a card advancing a started recipe,
//   +30 for the one completing it) over the 12-run matrix, seeds 1337/1338/1339 (scratch/f1/evo_matrix.ts):
//   | meta  | runs with ≥ 1 evolution | evolutions / run | first evolution (Size)          | fast clears < 480 s |
//   |-------|-------------------------|------------------|---------------------------------|---------------------|
//   | fresh | 11 / 8 / 11 of 12       | 1.5 / 0.9 / 1.2  | mostly III–IV (II…V)            | 0                   |
//   | full  | 12 / 11 / 9 of 12       | 1.7 / 1.6 / 1.9  | mostly III–IV (II…V)            | 0                   |
//   Pre-F1 rule, seed 1337: 1/12 fresh, 0/12 full. Evolution power vs a no-evolution control over 72 runs:
//   mean clear 564–575 s either way (evolutions trade for the generic best card, so no walkover).

import type { Rarity, UpgradeDef, World } from '../core/types.ts';
import { DRAFT_V2 } from '../core/config.ts';
import { UPGRADES, UPGRADE_BY_ID } from '../data/upgrades.ts';
import { EVOLUTIONS, EVO_OF_BASE, EVO_ROWS_OF_PART, EVO_NUDGE, evoReadyStacks } from '../data/evolutions.ts';
import type { EvolutionRow } from '../core/types.ts';
import { recomputeStats, stat } from './stats.ts';
import { applyUpgrade } from './engine.ts';

export const RARITY_BASE: Record<Rarity, number> = { common: 60, rare: 28, epic: 10, legendary: 2 };
export const RARITY_LUCK: Record<Rarity, number> = { common: 0, rare: 0.5, epic: 1, legendary: 1.5 };
export const OFFER_SIZE = 3;

/** Weight of a rarity at a luck value (never negative; a cursed-luck run still sees rares). */
export function rarityWeight(r: Rarity, luck: number): number {
  return RARITY_BASE[r] * Math.max(0.1, 1 + luck * RARITY_LUCK[r]);
}

const NONE: readonly string[] = [];
function banishedOf(w: World): readonly string[] { return w.upgrades.banished ?? NONE; }
function unlockedOf(w: World): readonly string[] { return (w.meta && w.meta.unlocked) || NONE; }

/** Is this card offerable to this world right now (ignoring the chest rarity rule)? */
export function isEligible(w: World, u: UpgradeDef): boolean {
  // v2 (FEATURES_V2 §7.1)
  if (u.evo || u.perk) return false;                                   // evolutions are offered, never rolled
  if (u.locked && !unlockedOf(w).includes(u.id)) return false;
  if (banishedOf(w).includes(u.id)) return false;
  const evo = EVO_OF_BASE[u.id];                                       // a base whose evolution is owned
  if (evo && (w.upgrades.owned[evo] ?? 0) > 0) return false;           // never comes back (owned[base] was deleted)
  // v1
  if (u.titan && u.titan !== w.titanId) return false;
  if ((u.minRank ?? 0) > w.titan.rank) return false;
  return (w.upgrades.owned[u.id] ?? 0) < u.maxStacks;
}

// which counter the live offer will consume (chest vs level-up), per UpgradeState
const OFFER_IS_CHEST = new WeakMap<object, boolean>();
// v2: the id rollOffer delivered into slot 0 from last draft's hold (UI: HELD FROM LAST REPORT)
const DELIVERED = new WeakMap<object, string>();
const POOL: UpgradeDef[] = [];
const POOL_M: number[] = [];                             // F1: per-card weight multiplier (recipe nudge), parallel to POOL
const WTS: number[] = [];

function buildPool(w: World, chest: boolean, exclude: readonly string[] | null, exclude2: readonly string[] | null = null): void {
  POOL.length = 0;
  POOL_M.length = 0;
  for (const u of UPGRADES) {
    if (!isEligible(w, u)) continue;
    if (chest && u.rarity === 'common') continue;
    if (exclude && exclude.includes(u.id)) continue;
    if (exclude2 && exclude2.includes(u.id)) continue;
    POOL.push(u);
    POOL_M.push(recipeNudge(w, u.id));
  }
}

const CNT: Record<Rarity, number> = { common: 0, rare: 0, epic: 0, legendary: 0 };

/**
 * Rarity-first sampling without replacement of up to `k` cards from POOL (one rng.loot draw per card).
 * F1: inside a rarity a card's share is POOL_M[i] / (sum of POOL_M over that rarity); the rarity split itself
 * is untouched. With every multiplier 1 the weights are bit-identical to the pre-F1 rarityWeight / count.
 */
function sample(w: World, k: number, out: string[]): void {
  const luck = stat(w, 'luck');
  let n = POOL.length;
  WTS.length = n;
  while (out.length < k && n > 0) {
    CNT.common = 0; CNT.rare = 0; CNT.epic = 0; CNT.legendary = 0;
    for (let i = 0; i < n; i++) CNT[POOL[i].rarity] += POOL_M[i];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = POOL[i].rarity;
      WTS[i] = rarityWeight(r, luck) * POOL_M[i] / CNT[r];
      total += WTS[i];
    }
    let x = w.rng.loot() * total;
    let pick = n - 1;
    for (let i = 0; i < n; i++) { x -= WTS[i]; if (x < 0) { pick = i; break; } }
    out.push(POOL[pick].id);
    // remove by shifting (keeps the remaining order = catalogue order → stable determinism)
    for (let i = pick; i < n - 1; i++) { POOL[i] = POOL[i + 1]; POOL_M[i] = POOL_M[i + 1]; }
    n--;
    POOL.length = n;
    POOL_M.length = n;
  }
}

/**
 * Roll up to `k` cards. `avoid` = ids to avoid when enough other cards exist (reroll); `hard` = ids that
 * are never rolled (a held card during a reroll). k = OFFER_SIZE with no `hard` is the v1 roll exactly.
 */
function roll(w: World, chest: boolean, avoid: readonly string[] | null, k = OFFER_SIZE, hard: readonly string[] | null = null): string[] {
  const out: string[] = [];
  // 1) the proper pool (optionally avoiding the current offer when there is enough else to show)
  if (avoid) {
    buildPool(w, chest, avoid, hard);
    if (POOL.length < k) buildPool(w, chest, hard);
  } else {
    buildPool(w, chest, hard);
  }
  sample(w, k, out);
  // 2) chest pool too thin → top up from commons (still eligible, still distinct)
  if (chest && out.length < k) {
    buildPool(w, false, out, hard);
    sample(w, k, out);
  }
  return out;
}

/** v2: ONE card of the draft's kind that is none of `exclude` (chest → rare+ first, then commons), or null. */
function rollOne(w: World, chest: boolean, exclude: readonly string[]): string | null {
  const out: string[] = [];
  buildPool(w, chest, exclude);
  sample(w, 1, out);
  if (chest && out.length === 0) {
    buildPool(w, false, exclude);
    sample(w, 1, out);
  }
  return out.length ? out[0] : null;
}

/** v2: can the held card be delivered? (an evolution: while its recipe is still ready) */
function heldDeliverable(w: World, id: string): boolean {
  const u = UPGRADE_BY_ID[id];
  if (!u) return false;
  if (u.evo) return evolutionsReady(w).includes(id);
  return isEligible(w, u);
}

/** v2: put `id` into slot `k` (replacing what sat there), or append it when the offer is shorter. */
function placeAt(ids: string[], k: number, id: string): void {
  if (ids.length > k) ids[k] = id;
  else ids.push(id);
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
  const ids = roll(w, chest, null);                     // the pre-v2 roll, same rng.loot draws
  U.rerolls = Math.max(0, Math.floor(stat(w, 'rerolls')));
  DELIVERED.delete(U);

  // v2 LOCK (§7.4.3): the held card takes slot 0; a duplicate of it in slot 1/2 is re-rolled once
  let heldPlaced = false;
  if (U.locked) {
    const held = U.locked;
    U.locked = null;
    if (heldDeliverable(w, held)) {
      const dup = ids.indexOf(held);
      if (dup !== 0) {
        placeAt(ids, 0, held);
        if (dup > 0) {
          const re = rollOne(w, chest, ids);
          if (re) ids[dup] = re;
          else ids.splice(dup, 1);
        }
      }
      heldPlaced = true;
      DELIVERED.set(U, held);
    }
    // not deliverable any more (maxed through a chest pick, banished …): dropped, charge not refunded
  }

  // v2 EVOLUTION (§7.4.4)
  const ready = evolutionsReady(w);
  if (ready.length > 0) {
    let evo: string | null = null;
    for (const id of ready) if (!ids.includes(id)) { evo = id; break; }
    if (evo) {
      if (chest) placeAt(ids, heldPlaced ? 1 : 0, evo);
      else if (ids.length === 0) ids.push(evo);                        // nothing else to show: never an empty draft
      else if (w.rng.loot() < DRAFT_V2.evoDraftChance) placeAt(ids, 2, evo);
    }
  }

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
  if (w.tally) w.tally.rerolls += 1;
  const heldSlot = U.locked ? U.offer.indexOf(U.locked) : -1;
  let ids: string[];
  if (heldSlot < 0) {
    ids = roll(w, chest, U.offer);
  } else {
    // v2 (§7.4.5): the held card keeps its slot; only the other slots are re-rolled (held id excluded)
    const held = U.locked as string;
    const others = roll(w, chest, U.offer, OFFER_SIZE - 1, [held]);
    ids = others.slice();
    ids.splice(Math.min(heldSlot, ids.length), 0, held);
  }
  DELIVERED.delete(U);
  U.offer = ids.length > 0 ? ids : null;
  return ids;
}

/**
 * Take a card: apply it, consume one pending draft (chest or level-up), clear the offer.
 * An id that could not be applied (unknown, another titan's, already maxed) is ignored and consumes
 * nothing, so a stale UI click can never burn a draft on a no-op.
 * v2: an evolution replaces its base card (owned + order); picking the held card clears the hold.
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
  if (u.evo && before === 0) evolveReplace(w, id, u.evo.base);
  if (U.locked === id) U.locked = null;                 // picking the held card: hold done, no extra charge
  const known = OFFER_IS_CHEST.get(U);
  const chest = known ?? (U.chestDrafts > 0);
  if (chest && U.chestDrafts > 0) U.chestDrafts -= 1;
  else if (U.pendingDrafts > 0) U.pendingDrafts -= 1;
  else if (U.chestDrafts > 0) U.chestDrafts -= 1;
  U.offer = null;
  OFFER_IS_CHEST.delete(U);
  DELIVERED.delete(U);
}

/** v2 (§7.3): the evolution takes the base card's place — delete owned[base], evo id replaces base in order. */
function evolveReplace(w: World, evoId: string, base: string): void {
  const U = w.upgrades;
  delete U.owned[base];
  const at = U.order.indexOf(base);
  const self = U.order.lastIndexOf(evoId);
  if (at >= 0) {
    if (self >= 0) U.order.splice(self, 1);
    U.order[at] = evoId;
  }
  recomputeStats(w);                                    // HP ratio kept (stats.ts)
  if (w.tally) w.tally.evolutions += 1;
}

/** A draft is owed AND at least one card can still be offered. */
export function hasPendingDraft(w: World): boolean {
  const U = w.upgrades;
  if (U.pendingDrafts <= 0 && U.chestDrafts <= 0) return false;
  if (U.offer && U.offer.length > 0) return true;
  for (const u of UPGRADES) if (isEligible(w, u)) return true;
  if (U.locked && heldDeliverable(w, U.locked)) return true;
  return evolutionsReady(w).length > 0;
}

// ─────────────────────────────── v2 additions (FEATURES_V2 §7.5, ModDraftAdd) ───────────────────────────────

/**
 * BANISH `id` from the open offer: out of the pool for the rest of the run; its slot is refilled in place
 * with one roll of the same draft kind that avoids the other offered cards (rng.loot). Empty refill → the
 * offer is one card shorter. Returns the new offer, or null when not allowed (no open offer containing
 * `id`, no BANISH charge left, or it is the last card of a 1-card offer with nothing to refill it).
 */
export function banishCard(w: World, id: string): string[] | null {
  const U = w.upgrades;
  const offer = U.offer;
  if (!offer || offer.length === 0 || !offer.includes(id) || !((U.banishLeft ?? 0) > 0)) return null;
  const chest = OFFER_IS_CHEST.get(U) ?? (U.chestDrafts > 0 && U.pendingDrafts === 0);
  const slot = offer.indexOf(id);
  if (!U.banished) U.banished = [];
  U.banished.push(id);                                  // before the refill: the banished id can never come back
  const re = rollOne(w, chest, offer);                  // avoids every card on the table
  if (!re && offer.length <= 1) { U.banished.pop(); return null; }   // empty pool: no draw was made
  const next = offer.slice();
  if (re) next[slot] = re;
  else next.splice(slot, 1);
  U.banishLeft -= 1;
  if (w.tally) w.tally.banishes += 1;
  if (U.locked === id) {                                // banishing the held card clears the hold + refunds
    U.locked = null;
    U.lockLeft += 1;
    if (w.tally && w.tally.locks > 0) w.tally.locks -= 1;
  }
  if (DELIVERED.get(U) === id) DELIVERED.delete(U);
  U.offer = next;
  return next;
}

/**
 * LOCK toggle on a card of the open offer. Holding a card spends a LOCK charge (needs lockLeft > 0);
 * unlocking it refunds the charge; locking another card moves the hold (no refund, no extra charge).
 * Returns true when `id` is now held.
 */
export function lockCard(w: World, id: string): boolean {
  const U = w.upgrades;
  if (!U.offer || !U.offer.includes(id)) return U.locked === id;
  if (U.locked === id) {                                // unlock within the draft → refund
    U.locked = null;
    U.lockLeft += 1;
    if (w.tally && w.tally.locks > 0) w.tally.locks -= 1;
    return false;
  }
  if (U.locked) {                                       // move the hold: the charge already spent covers it
    U.locked = id;
    return true;
  }
  if (!((U.lockLeft ?? 0) > 0)) return false;
  U.lockLeft -= 1;
  U.locked = id;
  if (w.tally) w.tally.locks += 1;
  return true;
}

/** F1: the evolution can still happen this run: not owned, this titan's (or generic), not banished, unlocked. */
function evoLive(w: World, r: EvolutionRow): boolean {
  if ((w.upgrades.owned[r.id] ?? 0) > 0) return false;
  const e = UPGRADE_BY_ID[r.id];
  if (!e || !UPGRADE_BY_ID[r.base] || !UPGRADE_BY_ID[r.with]) return false;
  if (e.titan && e.titan !== w.titanId) return false;
  if (banishedOf(w).includes(r.id)) return false;
  if (e.locked && !unlockedOf(w).includes(r.id)) return false;
  return true;
}

/**
 * Ready evolution ids in catalogue order: owned[evo] is 0, owned[base] >= min(EVO_READY_STACKS, base
 * maxStacks) (F1; was: maxed), owned[with] >= 1, the evo is not banished, it is this titan's (or generic),
 * and a `locked` evo is in w.meta.unlocked.
 */
export function evolutionsReady(w: World): string[] {
  const out: string[] = [];
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if (!evoLive(w, r)) continue;
    if ((owned[r.base] ?? 0) < evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks)) continue;
    if (!((owned[r.with] ?? 0) >= 1)) continue;
    out.push(r.id);
  }
  return out;
}

/**
 * F1 draft nudge: EVO_NUDGE when card `id` is the MISSING HALF of a live, started recipe — the companion
 * (not owned yet) once the base is owned, or the base (below its ready stacks) once the companion is owned —
 * else 1. A base never nudges itself (that only fed mono-stacking: measured, hearthback/lockwater cleared
 * < 480 s); pure function of the world (no draws).
 */
export function recipeNudge(w: World, id: string): number {
  const rows = EVO_ROWS_OF_PART[id];
  if (!rows) return 1;
  const owned = w.upgrades.owned;
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const haveB = owned[r.base] ?? 0, haveW = owned[r.with] ?? 0;
    if (id === r.base && haveB < evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks) && haveW >= 1) return EVO_NUDGE;
    if (id === r.with && haveW < 1 && haveB >= 1) return EVO_NUDGE;
  }
  return 1;
}

/** F1 recipe progress of one live recipe (UI hint rows: EVOLUTION READY / "2 OF 3 · NEEDS <WITH>"). */
export interface EvoProgress { evo: string; base: string; with: string; baseHave: number; baseNeed: number; withHave: boolean; ready: boolean }

/**
 * F1: every live recipe of this run that is STARTED (either half owned), ready ones first, then by how
 * close they are; catalogue order breaks ties. For the HUD / draft 'EVOLUTION READY' hint (read-only).
 */
export function evolutionProgress(w: World): EvoProgress[] {
  const out: EvoProgress[] = [];
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if (!evoLive(w, r)) continue;
    const baseHave = owned[r.base] ?? 0, withHave = (owned[r.with] ?? 0) >= 1;
    if (baseHave === 0 && !withHave) continue;
    const baseNeed = evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks);
    out.push({ evo: r.id, base: r.base, with: r.with, baseHave, baseNeed, withHave, ready: baseHave >= baseNeed && withHave });
  }
  const gap = (p: EvoProgress): number => Math.max(0, p.baseNeed - p.baseHave) + (p.withHave ? 0 : 1);
  return out.map((p, i) => ({ p, i })).sort((a, b) => gap(a.p) - gap(b.p) || a.i - b.i).map((x) => x.p);
}

/**
 * F1: for an offered card, the evolution it advances (`completes` = taking it makes that recipe ready),
 * or null. Draft-card hint ("COMPLETES <EVO NAME>" / "TOWARD <EVO NAME>"); only started recipes count.
 */
export function recipeHint(w: World, id: string): { evo: string; completes: boolean } | null {
  const rows = EVO_ROWS_OF_PART[id];
  if (!rows) return null;
  const owned = w.upgrades.owned;
  let best: { evo: string; completes: boolean } | null = null;
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const need = evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks);
    let haveB = owned[r.base] ?? 0, haveW = owned[r.with] ?? 0;
    if (haveB === 0 && haveW === 0) continue;
    if (id === r.base) { if (haveB >= need) continue; haveB++; }
    else { if (haveW >= 1) continue; haveW++; }
    const completes = haveB >= need && haveW >= 1;
    if (!best || (completes && !best.completes)) best = { evo: r.id, completes };
  }
  return best;
}

/**
 * v2 (lane-internal, for the draft UI's `HELD FROM LAST REPORT` stamp): the id the current offer received
 * in slot 0 from last draft's hold, or null. Cleared by a reroll, a pick, or banishing that card.
 */
export function deliveredHold(w: World): string | null {
  return DELIVERED.get(w.upgrades) ?? null;
}
