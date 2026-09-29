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

import type { DraftCardSlot, OverflowRewardId, Rarity, UpgradeDef, World } from '../core/types.ts';
import { OVERFLOW_REWARD_IDS } from '../core/types.ts';
import { DRAFT_V2, ULT } from '../core/config.ts';
import { healTitan } from '../titans/titansim.ts';
import { addUproar } from '../meta/ultimate.ts';
import { UPGRADES, UPGRADE_BY_ID } from '../data/upgrades.ts';
import { EVOLUTIONS, EVO_OF_BASE, EVO_ROWS_OF_PART, EVO_NUDGE, EVO_LATE_LEVEL, EVO_LATE_NUDGE, evoReadyStacks } from '../data/evolutions.ts';
import type { EvolutionRow } from '../core/types.ts';
import { recomputeStats, stat } from './stats.ts';
import { applyUpgrade } from './engine.ts';

export const RARITY_BASE: Record<Rarity, number> = { common: 60, rare: 28, epic: 10, legendary: 2 };
export const RARITY_LUCK: Record<Rarity, number> = { common: 0, rare: 0.5, epic: 1, legendary: 1.5 };
export const OFFER_SIZE = 3;

// ─────────────── TITAN PASS D1 BUILD SLOTS (FEATURES_V2 §7.7; lane DRAFT) ───────────────
// Owner decision 2026-09-29: "tier" = card LEVEL; the fix is BUILD SLOTS (Vampire-Survivors style): once SLOT_CAP
// distinct cards are held, a draft offers only cards that need no new slot (owned-not-maxed cards, the missing half
// of a started recipe, ready evolutions). Every draft still shows OFFER_SIZE cards: when the restricted pool is
// thinner than that, the offer is topped up with OVERFLOW rewards (no slot, never owned, no rng draw).
//   * slotsUsed: distinct owned non-perk cards, minus one per recipe PAIR (base + companion of a live recipe, or an
//     owned evolution + its companion; pairs assigned in EVOLUTIONS order, each card in at most one pair).
//     ONE-OFF cards (isOneOff: maxStacks 1 — the legendary trade-offs and the no-scaling triggers) take no slot
//     (tag 'free'): an un-upgradable card in a slot would be a dead slot. Offered while the slots fill, not after.
//   * slots NOT full → the pre-D1 pool and draws (same rng.loot count); an overflow reward is never shown then.
//     Only the roll WEIGHTS differ while the START CALL is on (startCall: slots filling, below EVO_LATE_LEVEL,
//     no live recipe started → every live recipe half ×EVO_START_NUDGE inside its rarity). Without it a run
//     fills its slots before it starts a recipe and can then never start one (a first half needs a new slot):
//     36-run study, start call off → 0.75 evolutions/run, 20/36 runs with one; on → see the table below.
//   * slots full → buildPool keeps only cards whose cardSlot is not 'new'; a LOCKed card that would need a new slot
//     is dropped at delivery and its LOCK charge refunded; a ready evolution fills a short offer before any padding
//     (no draw); the rest is padded with OVERFLOW rewards, most-needed first (overflowOrder, pure function).
//   * OVERFLOW rewards cannot be rerolled, banished or locked; picking one consumes the draft like a card.
//   * maxStacks (data/upgrades.ts, upgrades_v2.ts): with 8 slots a run's ~40 drafts must land on 8 cards, so 119
//     cards whose every stack adds power (a stat effect, or a trigger with a STACK_SCALED_KEYS param) got +1 max
//     stack (2→3 / 3→4 / 4→5; 1→2-3 for 5 single-stack cards with a scaling effect); u_rolling_closure and
//     u_street_festival went 3 → 1 (their trigger has no stack-scaled param: stacks 2-3 did nothing on HEAD), so
//     they are ONE-OFF cards now. Per-card list: _harness/scratch/tp/DRAFT/raise.json + raisecheck.mts.
// Measured (lane DRAFT, _harness/scratch/tp/DRAFT/study.mts, 36 runs): see the TITAN PASS D1 table at the bottom.

/** Distinct cards a run can hold. Starting value = the measured `slots8` mode (titanpass/draft_stacking.md). */
export const SLOT_CAP = 8;
/** OVERFLOW rewards: SICK DAY heals this share of max HP; HOT TIP adds this share of ULT.max to the UPROAR meter
 *  (banked like BACK PAY if UPROAR is cooling); HARD HAT raises the absorb shield by this share of max HP, capped at
 *  hardHatCap × max HP (= engine.ts SHIELD_CAP_FRAC, the cap every shield card obeys; it decays like theirs).
 *  No rng draw in any of them, and none of them is XP: an XP reward was tried first (OVERTIME, 0.5 of a level's
 *  bar) and fed itself — each level it bought owed another slot-full draft (molo × 3 cities, seed 1337: 55 OVERTIME
 *  picks in 132 drafts, LV 43 vs 37-38), so overflow must never grant a draft. */
export const OVERFLOW = { sickDayHeal: 0.25, hotTipUproar: 0.35, hardHatShield: 0.3, hardHatCap: 0.5 } as const;

/** The OVERFLOW rewards this file serves, in display order (types.ts OVERFLOW_REWARD_IDS: SICK DAY, HOT TIP, HARD HAT;
 *  three, so a slot-full draft with an EMPTY pool still shows OFFER_SIZE cards). */
export type OverflowId = OverflowRewardId;
export const OVERFLOW_IDS: readonly OverflowId[] = OVERFLOW_REWARD_IDS;

/** Is this offer id an OVERFLOW reward rather than a card? */
export function isOverflowReward(id: string): id is OverflowId {
  return (OVERFLOW_IDS as readonly string[]).includes(id);
}

// scratch for slot bookkeeping (no allocation per call beyond the Set clear)
const PAIRED = new Set<string>();

/** Fill PAIRED with every card that shares a slot with its recipe partner (EVOLUTIONS order, one pair per card). */
function computePairs(w: World): void {
  PAIRED.clear();
  const owned = w.upgrades.owned;
  for (const r of EVOLUTIONS) {
    if (!((owned[r.with] ?? 0) > 0) || PAIRED.has(r.with)) continue;
    let other: string | null = null;
    if ((owned[r.id] ?? 0) > 0) other = r.id;                                   // evolved: evo + companion
    else if ((owned[r.base] ?? 0) > 0 && evoLive(w, r)) other = r.base;          // live recipe, both halves held
    if (!other || PAIRED.has(other)) continue;
    PAIRED.add(other);
    PAIRED.add(r.with);
  }
}

/** Slots in use (FEATURES_V2 §7.7): distinct owned non-perk cards, a recipe pair counting once. Pure, no draws. */
export function slotsUsed(w: World): number {
  const owned = w.upgrades.owned;
  let n = 0;
  for (const id in owned) {
    if (!((owned[id] ?? 0) > 0)) continue;
    const u = UPGRADE_BY_ID[id];
    if (!u || u.perk || isOneOff(u)) continue;
    n++;
  }
  computePairs(w);
  return n - PAIRED.size / 2;
}

/** D1: a ONE-OFF card (maxStacks 1, not an evolution) files outside the slots: it can never be upgraded, so charging
 *  it a slot would make every one-shot trade-off a dead slot. It is NOT offered once the slots are full: tried, and
 *  the slot-full pool (a few owned cards + every one-off) then renormalised the rarity roll onto the one-offs — the
 *  bot collected 12-13 legendary trade-offs per run (scratch/tp/DRAFT/study_partial_oneoffs_when_full_REJECTED.txt). */
export function isOneOff(u: UpgradeDef): boolean {
  return u.maxStacks <= 1 && !u.evo && !u.perk;
}

/** Every slot taken: only cards that need no new slot are offered. */
export function slotsFull(w: World): boolean {
  return slotsUsed(w) >= SLOT_CAP;
}

/** Unowned `id` is the missing half of a live recipe whose other half is held and not yet paired (PAIRED current). */
function sharesSlot(w: World, id: string): boolean {
  const rows = EVO_ROWS_OF_PART[id];
  if (!rows) return false;
  const owned = w.upgrades.owned;
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const partner = id === r.base ? r.with : id === r.with ? r.base : null;
    if (!partner || !((owned[partner] ?? 0) > 0) || PAIRED.has(partner)) continue;
    return true;
  }
  return false;
}

/** The slot tag of an offered card (types.ts DraftCardSlot; 'free' = a ONE-OFF card, isOneOff: files outside the slots). */
export type SlotTag = DraftCardSlot;

/** The slot tag of an offered id (draft UI; the slot-full pool keeps every non-'new' card). */
export function cardSlot(w: World, id: string): SlotTag {
  if (isOverflowReward(id)) return 'overflow';
  const u = UPGRADE_BY_ID[id];
  if (u?.evo) return 'evolution';
  if ((w.upgrades.owned[id] ?? 0) > 0) return 'upgrade';
  if (u && isOneOff(u)) return 'free';
  computePairs(w);
  return sharesSlot(w, id) ? 'shared' : 'new';
}

/** OVERFLOW rewards, most-needed first (pure function of the world: hurt → SICK DAY; UPROAR not ready → HOT TIP). */
export function overflowOrder(w: World): OverflowId[] {
  const T = w.titan;
  const hurt = T.maxHp > 0 ? 1 - T.hp / T.maxHp : 0;
  const score = (id: OverflowId): number =>
    id === 'ovf_sick_day' ? hurt * 4 : id === 'ovf_hot_tip' ? (w.ult && !w.ult.ready ? 1 : 0) : w.upgrades.shield > 0 ? 0 : 0.5;
  return OVERFLOW_IDS.slice().sort((a, b) => score(b) - score(a) || OVERFLOW_IDS.indexOf(a) - OVERFLOW_IDS.indexOf(b));
}

/** Top a slot-full offer up to OFFER_SIZE with OVERFLOW rewards (most-needed first). No draws. */
function padOverflow(w: World, ids: string[]): void {
  if (ids.length >= OFFER_SIZE) return;
  for (const id of overflowOrder(w)) {
    if (ids.length >= OFFER_SIZE) break;
    if (!ids.includes(id)) ids.push(id);
  }
}

/** Apply an OVERFLOW reward (FEATURES_V2 §7.7 rule 5). */
function applyOverflow(w: World, id: OverflowId): void {
  if (id === 'ovf_sick_day') healTitan(w, OVERFLOW.sickDayHeal * w.titan.maxHp);
  else if (id === 'ovf_hot_tip') addUproar(w, OVERFLOW.hotTipUproar * ULT.max, true);
  else {
    const U = w.upgrades, cap = OVERFLOW.hardHatCap * w.titan.maxHp;
    U.shield = Math.max(U.shield, Math.min(U.shield + OVERFLOW.hardHatShield * w.titan.maxHp, cap));
  }
}

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
  const full = slotsFull(w);                             // D1: also leaves PAIRED current for sharesSlot
  for (const u of UPGRADES) {
    if (!isEligible(w, u)) continue;
    if (full && !((w.upgrades.owned[u.id] ?? 0) > 0) && !sharesSlot(w, u.id)) continue;   // D1: new cards (one-offs too) wait
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
  return isEligible(w, u) && !slotBlocked(w, id);
}

/** D1: a card that would need a NEW slot while every slot is taken (never an evolution or an overflow reward). */
function slotBlocked(w: World, id: string): boolean {
  if (isOverflowReward(id) || UPGRADE_BY_ID[id]?.evo) return false;
  return cardSlot(w, id) === 'new' && slotsFull(w);
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
    } else if (slotBlocked(w, held)) {
      // D1: the slot rule made it undeliverable (not the player): dropped, LOCK charge refunded
      U.lockLeft += 1;
      if (w.tally && w.tally.locks > 0) w.tally.locks -= 1;
    }
    // not deliverable any more (maxed through a chest pick, banished …): dropped, charge not refunded
  }

  // v2 EVOLUTION (§7.4.4)
  const full = slotsFull(w);
  const ready = evolutionsReady(w);
  if (ready.length > 0) {
    let evo: string | null = null;
    for (const id of ready) if (!ids.includes(id)) { evo = id; break; }
    if (evo) {
      if (chest) placeAt(ids, heldPlaced ? 1 : 0, evo);
      else if (ids.length === 0) ids.push(evo);                        // nothing else to show: never an empty draft
      else if (full && ids.length < OFFER_SIZE) ids.push(evo);         // D1: a short slot-full offer shows it (no draw)
      else {
        const x = w.rng.loot();                                          // drawn either way: draw count unchanged
        if (x < DRAFT_V2.evoDraftChance || lateCall(w) !== null) placeAt(ids, 2, evo);   // fx2/D late call: always
      }
    }
  }

  if (full) padOverflow(w, ids);                                        // D1: every draft shows OFFER_SIZE cards
  U.offer = ids.length > 0 ? ids : null;
  OFFER_IS_CHEST.set(U, chest);
  return ids;
}

/** Spend one reroll on a fresh offer of the same kind. null when no reroll or no open offer. */
export function rerollOffer(w: World): string[] | null {
  const U = w.upgrades;
  if (!U.offer || U.offer.length === 0 || U.rerolls <= 0) return null;
  if (!U.offer.some((id) => !isOverflowReward(id))) return null;      // D1: an all-OVERFLOW offer cannot be rerolled
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
  if (slotsFull(w)) padOverflow(w, ids);                                // D1
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
  if (isOverflowReward(id)) {                                           // D1 OVERFLOW reward: only from the open offer
    if (!U.offer || !U.offer.includes(id)) return;
    applyOverflow(w, id);
    consumeDraft(w);
    return;
  }
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
  consumeDraft(w);
}

/** Consume one owed draft (chest or level-up, whichever the open offer was rolled for) and close the offer. */
function consumeDraft(w: World): void {
  const U = w.upgrades;
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
  if (slotsFull(w)) return true;                                        // D1: OVERFLOW rewards: never nothing to offer
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
  if (isOverflowReward(id)) return null;                                // D1: an OVERFLOW reward cannot be banished
  const chest = OFFER_IS_CHEST.get(U) ?? (U.chestDrafts > 0 && U.pendingDrafts === 0);
  const slot = offer.indexOf(id);
  if (!U.banished) U.banished = [];
  U.banished.push(id);                                  // before the refill: the banished id can never come back
  const re = rollOne(w, chest, offer);                  // avoids every card on the table
  if (!re && offer.length <= 1) { U.banished.pop(); return null; }   // empty pool: no draw was made
  const next = offer.slice();
  if (re) next[slot] = re;
  else next.splice(slot, 1);
  if (!re && slotsFull(w)) padOverflow(w, next);                        // D1: the offer keeps OFFER_SIZE cards
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
  if (isOverflowReward(id)) return false;                               // D1: an OVERFLOW reward cannot be held
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
  if (startCall(w)) { for (const r of rows) if (evoLive(w, r)) return EVO_START_NUDGE; }   // D1 slot-filling start call
  const late = lateCall(w);
  if (late) {                                                           // fx2/D late call (data/evolutions.ts)
    if (late.kind === 'start') { for (const r of rows) if (evoLive(w, r)) return EVO_NUDGE; }
    else if (late.kind === 'finish') {
      const p = late.target;
      if (id === p.base && p.baseHave < p.baseNeed) return EVO_LATE_NUDGE;
      if (id === p.with && !p.withHave) return EVO_LATE_NUDGE;
    }
  }
  for (const r of rows) {
    if (!evoLive(w, r)) continue;
    const haveB = owned[r.base] ?? 0, haveW = owned[r.with] ?? 0;
    if (id === r.base && haveB < evoReadyStacks(UPGRADE_BY_ID[r.base].maxStacks) && haveW >= 1) return EVO_NUDGE;
    if (id === r.with && haveW < 1 && haveB >= 1) return EVO_NUDGE;
  }
  return 1;
}

/** D1 (FEATURES_V2 §7.7 rule 6): roll-weight multiplier (inside the rarity) for every half of every live recipe
 *  while the START CALL is on. Measured: see the TITAN PASS D1 table at the bottom of this file. */
export const EVO_START_NUDGE = 3;

/**
 * D1 START CALL: while the slots are still filling (not full), before the fx2/D late level, and no live recipe has
 * either half owned, every half of every live recipe rolls at EVO_START_NUDGE. Once the slots are full a recipe can
 * no longer be started (a first half needs a new slot), so this is where a run's evolution gets seeded; the late
 * call's own 'start' stays for a run that reaches EVO_LATE_LEVEL with free slots. Pure function (no draws).
 */
export function startCall(w: World): boolean {
  if (w.titan.level >= EVO_LATE_LEVEL || slotsFull(w)) return false;
  const owned = w.upgrades.owned;
  let live = false;
  for (const r of EVOLUTIONS) {
    if (!evoLive(w, r)) continue;
    if ((owned[r.base] ?? 0) > 0 || (owned[r.with] ?? 0) > 0) return false;
    live = true;
  }
  return live;
}

/**
 * fx2/D LATE CALL state (data/evolutions.ts EVO_LATE_LEVEL): null before that level or once the titan owns an
 * evolution; 'start' = no live recipe started; 'finish' = the closest started recipe (evolutionProgress[0]);
 * 'ready' = a recipe is ready (a level-up draft then always shows it). Pure function of the world (no draws).
 */
export type LateCall = { kind: 'start' } | { kind: 'finish'; target: EvoProgress } | { kind: 'ready'; evo: string };
export function lateCall(w: World): LateCall | null {
  if (w.titan.level < EVO_LATE_LEVEL) return null;
  for (const id in w.upgrades.owned) if ((w.upgrades.owned[id] ?? 0) > 0 && UPGRADE_BY_ID[id]?.evo) return null;
  const prog = evolutionProgress(w);
  if (prog.length === 0) {
    for (const r of EVOLUTIONS) if (evoLive(w, r)) return { kind: 'start' };
    return null;                                                        // no live recipe at all (all banished)
  }
  return prog[0].ready ? { kind: 'ready', evo: prog[0].evo } : { kind: 'finish', target: prog[0] };
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
  // fx2/D: equal gap → the most-stacked base first (the late call's target), then catalogue order
  return out.map((p, i) => ({ p, i })).sort((a, b) => gap(a.p) - gap(b.p) || b.p.baseHave - a.p.baseHave || a.i - b.i).map((x) => x.p);
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

// ─────────────── TITAN PASS D1 table (lane DRAFT, 2026-09-29) ───────────────
// _harness/scratch/tp/DRAFT/study.mts (port of titanpass/study2.mts): 4 titans × 3 cities × seeds 1337/7/99 = 36 real-sim
// runs, fresh profile, GATE 2 bot (bot.ts + bot_draft.ts). Acceptance bands from the task / FEATURES_V2 §7.7 rule 8.
//   | metric                               | HEAD (study2 base) | slots8 prototype | shipped D1      | band     |
//   |--------------------------------------|--------------------|------------------|-----------------|----------|
//   | offers showing an owned card         | ~14 %              | 62.6 %           | 62.1 %          | ≥ 60 %   |
//   | non-evo cards ending at ≥ 3 stacks   | 1.5 %              | 47.5 %           | 76.6 %          | ≥ 45 %   |
//   | evolutions / run · runs with one     | 1.17               | 0.78             | 1.14 · 31/36    | ≥ 1.0 · ≥ 28/36 |
//   | empty / short (< 3) offers           | —                  | 5-11 / run empty; 2.3-2.7 cards late | 0 / 0 (3.00 per offer) | 0 |
//   | OVERFLOW rewards taken               | —                  | —                | 14.1 % of drafts | < 30 %  |
//   | clears (bot)                         |                    |                  | 35/36, median 624 s |      |
// Start call OFF (same tree, scratch copy): 0.75 evolutions/run, 20/36 runs — below the band, so it ships ON.
// ONE-OFF cards offered while full: rejected (the bot collected 12-13 legendary trade-offs per run).
