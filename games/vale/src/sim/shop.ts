// VALE sim — in-match item shop (CONTRACT §5.6).
//
// Access (rules.shopAccess):
//   base          alive and inside the team's base shop circle (MapDef.bases[].shop)
//   base_or_dead  inside the base shop circle, or dead
//   anywhere      always (alive or dead)
//   shops         alive and inside any MapDef.shops circle (or the team's base shop, if it has one)
// Pool: an item is sold when ItemDef.pools is empty or contains rules.itemPool.
//
// Buying: price = item.cost − value of owned components it consumes. Components are matched
// recursively: an owned component is consumed at its full cost; a missing one is looked for one
// level down (its own components), and so on. The new item takes the first consumed slot, else
// the first empty one (6 slots). uniqueGroup: no two owned items of a group (components being
// consumed by this purchase do not count). Consumables stack into a slot holding the same item
// while charges ≤ consumable.charges × consumable.maxStack.
// Selling refunds floor(cost × sellRatio) — for consumables × charges / consumable.charges.
// Refunds are not "earned" gold (goldEarned is unchanged) and emit 'sell' + 'gold' (reason 'sell').
// Undo: every buy/sell since the seat entered the shop can be undone in reverse order (exact gold
// and inventory restore). The stack clears when the seat can no longer shop and on combat (the
// seat's fighter dealt damage to, or took damage from, an enemy fighter).
// Item stats / passives / actives are wired by core equipItem (stats.ts, the passive dispatcher,
// item active slots). swapItems only relabels slots (actives keep cooldowns, charges and recasts;
// passives keep their trigger cooldowns); an undo puts items back with their active's cooldown and
// charges as they were (minus the time since), so sell + undo is never a free cooldown reset.
// Removing an item (sell, recipe consumption, undo) cancels a cast of its active in progress.
//
// Refusals emit 'announce' { key: 'shop_denied', player, params: { item, reason } } so the HUD can
// play its error feedback; reasons are ShopDenied.

import type { ItemDefT } from '../contracts/catalog.ts';
import type { Command } from '../contracts/sim.ts';
import { equipItem, interruptCast, itemSlotTimer, restoreItemSlotTimer, swapItemSlots, type ItemSlotTimer } from './abilities.ts';
import { SLOT_ITEM1, type Entity, type Player } from './entity.ts';
import type { World } from './world.ts';

export const ITEM_SLOTS = 6;
export type ShopDenied = 'unknown' | 'pool' | 'access' | 'gold' | 'slots' | 'unique' | 'empty';

export interface BuyQuote {
  ok: boolean;
  reason?: ShopDenied;
  /** gold the purchase costs right now (after owned components) */
  price: number;
  /** inventory slots whose items are consumed as components */
  consumes: number[];
  /** slot the item lands in (or stacks into) */
  slot: number;
  stack: boolean;
}

interface UndoEntry { kind: 'buy' | 'sell'; item: string; items: (string | null)[]; charges: number[]; timers: (ItemSlotTimer | null)[]; gold: number }
interface ShopState { undo: UndoEntry[][]; couldShop: boolean[] }
const KEY = 'shop';
function shopState(w: World): ShopState { return w.ext[KEY] as ShopState; }

// ── access + pool ───────────────────────────────────────────────────────────────────────────────
function inCircle(x: number, y: number, c: { at: readonly [number, number] | number[]; radius: number }): boolean {
  const dx = x - c.at[0], dy = y - c.at[1];
  return dx * dx + dy * dy <= c.radius * c.radius;
}

/** may this seat use the shop right now (rules.shopAccess) */
export function canShopNow(w: World, p: Player): boolean {
  const e = p.ent;
  if (!e || w.phase === 'ended') return false;
  const base = w.mapDef.bases.find((b) => b.team === p.team);
  const inBase = !!base && inCircle(e.x, e.y, base.shop);
  switch (w.rules.shopAccess) {
    case 'anywhere': return true;
    case 'base': return e.alive && inBase;
    case 'base_or_dead': return !e.alive || inBase;
    case 'shops': return e.alive && (inBase || w.mapDef.shops.some((s) => inCircle(e.x, e.y, s)));
  }
}

export function itemInPool(w: World, item: ItemDefT): boolean {
  return item.pools.length === 0 || item.pools.includes(w.rules.itemPool);
}

// ── quotes ──────────────────────────────────────────────────────────────────────────────────────
/** consume owned components of `item` (recursively); returns the gold value consumed */
function claimComponents(w: World, item: ItemDefT, owned: readonly (string | null)[], claimed: boolean[], depth: number): number {
  if (depth > 8) return 0;
  let value = 0;
  for (const cid of item.components) {
    let k = -1;
    for (let i = 0; i < owned.length; i++) if (!claimed[i] && owned[i] === cid) { k = i; break; }
    if (k >= 0) { claimed[k] = true; value += w.idx.items.get(cid)?.cost ?? 0; continue; }
    const sub = w.idx.items.get(cid);
    if (sub) value += claimComponents(w, sub, owned, claimed, depth + 1);
  }
  return value;
}

/** what buying `itemId` would cost and do; never changes state */
export function quoteBuy(w: World, p: Player, itemId: string, checkAccess = true): BuyQuote {
  const no = (reason: ShopDenied, price = 0): BuyQuote => ({ ok: false, reason, price, consumes: [], slot: -1, stack: false });
  const def = w.idx.items.get(itemId);
  if (!def) return no('unknown');
  if (!itemInPool(w, def)) return no('pool');
  const items = p.items;
  // consumables stack first
  if (def.consumable) {
    const cap = def.consumable.charges * def.consumable.maxStack;
    for (let i = 0; i < ITEM_SLOTS; i++) {
      if (items[i] === itemId && p.itemCharges[i] + def.consumable.charges <= cap) {
        if (checkAccess && !canShopNow(w, p)) return no('access', def.cost);
        if (p.gold + 1e-9 < def.cost) return no('gold', def.cost);
        return { ok: true, price: def.cost, consumes: [], slot: i, stack: true };
      }
    }
  }
  const claimed = new Array<boolean>(ITEM_SLOTS).fill(false);
  const discount = claimComponents(w, def, items, claimed, 0);
  const price = Math.max(0, def.cost - discount);
  const consumes: number[] = [];
  for (let i = 0; i < ITEM_SLOTS; i++) if (claimed[i]) consumes.push(i);
  let slot = consumes.length > 0 ? consumes[0] : -1;
  if (slot < 0) for (let i = 0; i < ITEM_SLOTS; i++) if (!items[i]) { slot = i; break; }
  if (checkAccess && !canShopNow(w, p)) return no('access', price);
  if (slot < 0) return no('slots', price);
  if (def.uniqueGroup) {
    for (let i = 0; i < ITEM_SLOTS; i++) {
      const id = items[i];
      if (!id || claimed[i]) continue;
      if (w.idx.items.get(id)?.uniqueGroup === def.uniqueGroup) return no('unique', price);
    }
  }
  if (p.gold + 1e-9 < price) return no('gold', price);
  return { ok: true, price, consumes, slot, stack: false };
}

// ── actions ─────────────────────────────────────────────────────────────────────────────────────
/** inventory + each item active's cooldown/charges, so an undo restores state, not a fresh item */
function snapshot(w: World, p: Player): { items: (string | null)[]; charges: number[]; timers: (ItemSlotTimer | null)[] } {
  const e = p.ent!;
  const timers: (ItemSlotTimer | null)[] = [];
  for (let i = 0; i < ITEM_SLOTS; i++) timers.push(itemSlotTimer(w, e, i));
  return { items: p.items.slice(), charges: p.itemCharges.slice(), timers };
}

/** an item leaving a slot takes its in-progress cast (windup or channel) with it */
function dropItemCast(w: World, e: Entity, index: number): void {
  const cs = e.cast;
  if (cs && cs.slot && cs.slot === e.slots[SLOT_ITEM1 + index]) interruptCast(w, e, false);
}

function deny(w: World, p: Player, item: string, reason: ShopDenied): void {
  w.emit({ e: 'announce', t: w.time, key: 'shop_denied', player: p.player, team: p.team, params: { item, reason } });
}

export function buyItem(w: World, p: Player, itemId: string): BuyQuote {
  const q = quoteBuy(w, p, itemId);
  const e = p.ent;
  if (!q.ok || !e) { deny(w, p, itemId, q.reason ?? 'access'); return q; }
  const def = w.idx.items.get(itemId)!;
  const snap = snapshot(w, p);
  if (q.stack) {
    p.itemCharges[q.slot] += def.consumable!.charges;
  } else {
    for (const i of q.consumes) { dropItemCast(w, e, i); equipItem(w, e, i, null); }
    equipItem(w, e, q.slot, itemId);
  }
  p.gold -= q.price;
  shopState(w).undo[p.player].push({ kind: 'buy', item: itemId, items: snap.items, charges: snap.charges, timers: snap.timers, gold: -q.price });
  w.emit({ e: 'buy', t: w.time, player: p.player, item: itemId });
  return q;
}

export function sellValue(w: World, p: Player, slot: number): number {
  const id = p.items[slot];
  const def = id ? w.idx.items.get(id) : undefined;
  if (!def) return 0;
  const frac = def.consumable ? p.itemCharges[slot] / def.consumable.charges : 1;
  return Math.floor(def.cost * def.sellRatio * frac);
}

export function sellItem(w: World, p: Player, slot: number): boolean {
  const e = p.ent;
  const id = Number.isInteger(slot) && slot >= 0 && slot < ITEM_SLOTS ? p.items[slot] : null;
  if (!e || !id) { deny(w, p, id ?? '', 'empty'); return false; }
  if (!canShopNow(w, p)) { deny(w, p, id, 'access'); return false; }
  const snap = snapshot(w, p);
  const refund = sellValue(w, p, slot);
  dropItemCast(w, e, slot);
  equipItem(w, e, slot, null);
  p.gold += refund;
  shopState(w).undo[p.player].push({ kind: 'sell', item: id, items: snap.items, charges: snap.charges, timers: snap.timers, gold: refund });
  w.emit({ e: 'sell', t: w.time, player: p.player, item: id });
  if (refund > 0) w.emit({ e: 'gold', t: w.time, player: p.player, amount: refund, x: e.x, y: e.y, reason: 'sell' });
  return true;
}

/** restore an inventory snapshot, re-equipping only the slots that differ (with their saved timers) */
function restore(w: World, p: Player, u: UndoEntry): void {
  const e = p.ent!;
  for (let i = 0; i < ITEM_SLOTS; i++) {
    if (p.items[i] !== u.items[i]) {
      dropItemCast(w, e, i);
      equipItem(w, e, i, u.items[i]);
      restoreItemSlotTimer(w, e, i, u.timers[i]);
    }
    p.itemCharges[i] = u.charges[i];
  }
}

export function undoShop(w: World, p: Player): boolean {
  const stack = shopState(w).undo[p.player];
  if (!stack || stack.length === 0 || !p.ent || !canShopNow(w, p)) return false;
  const u = stack.pop()!;
  restore(w, p, u);
  p.gold -= u.gold;
  return true;
}

export function swapItems(w: World, p: Player, a: number, b: number): boolean {
  const e = p.ent;
  if (!e || !Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= ITEM_SLOTS || b >= ITEM_SLOTS) return false;
  swapItemSlots(w, e, a, b);
  return true;
}

export function clearUndo(w: World, player: number): void {
  const s = shopState(w).undo[player];
  if (s) s.length = 0;
}
export function undoDepth(w: World, player: number): number { return shopState(w).undo[player]?.length ?? 0; }

/** 'modes' phase: PlayerView.canShop; leaving the shop clears the undo stack */
export function shopViewSystem(w: World): void {
  const st = shopState(w);
  for (const p of w.players) {
    if (!p) continue;
    const can = canShopNow(w, p);
    if (!can && st.couldShop[p.player]) clearUndo(w, p.player);
    st.couldShop[p.player] = can;
    p.canShop = can;
  }
}

export function installShop(w: World): void {
  const n = w.setup.seats.length;
  const st: ShopState = { undo: Array.from({ length: n }, () => []), couldShop: new Array(n).fill(false) };
  w.ext[KEY] = st;
  const c = w.hooks.command;
  c.buy = (ww, p, cmd) => { buyItem(ww, p, (cmd as Extract<Command, { type: 'buy' }>).item); };
  c.sell = (ww, p, cmd) => { sellItem(ww, p, (cmd as Extract<Command, { type: 'sell' }>).slot); };
  c.undo = (ww, p) => { undoShop(ww, p); };
  c.swapItems = (ww, p, cmd) => { const s = cmd as Extract<Command, { type: 'swapItems' }>; swapItems(ww, p, s.a, s.b); };
  // combat between fighters ends the undo window for both seats
  w.hooks.damage.push((ww, src, dst) => {
    if (dst.kind !== 'fighter' || !dst.player) return;
    const f = ww.creditFighter(src);
    if (!f || !f.player || f.team === dst.team) return;
    clearUndo(ww, dst.player.player);
    clearUndo(ww, f.player.player);
  });
}
