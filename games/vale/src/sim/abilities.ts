// VALE sim — ability slots and the cast pipeline (CONTRACT §5.2, §5.3; catalog AbilityDef).
//
// One pipeline for fighter abilities (a1..ult), battle spells (spell1/spell2) and item actives
// (item1..6):
//   validate (rank > 0, not busy, CC gates, cooldown/charges/recast lock, cost, target filter +
//   visibility) → out of range? remember the cast as an ORDER_CAST and walk into range →
//   windup (castTime; hard CC / silence cancel it, and a unit target that died or became
//   untargetable makes it fizzle — nothing is spent either way) → release: pay cost, start
//   cooldown, break invisibility, run `effects` (or enter the channel) → abilityCast triggers.
// Channels: `onTick` every `interval`; `effects` run when the channel COMPLETES; interruptible
// channels end on hard CC/silence; a move order ends a channel unless `canMove`.
// Recast: casting a record with `recast` opens a window during which the slot casts
// `recast.ability` (its own `cooldown` is the lockout before the recast may be used); the
// original cooldown starts when the window closes (recast used or expired).
// Charges: `charges.max` stacks recharging every `recharge` s; `cooldown` is the lockout between
// uses. Cooldown haste (`cd × 100 / (100 + haste)`) applies to a1..ult only.
// Ranks: basic abilities cap at min(maxRank, rules.abilityRanks.basicMax, ceil(level / 2));
// the ult's rank r needs level ≥ ultLevels[r − 1]. One skill point per level.

import type { AbilityDefT, SlotT } from '../contracts/catalog.ts';
import { TICK_DT, type EntityId } from '../contracts/sim.ts';
import type { AbilityCoreT } from './catalog_index.ts';
import { makeCtx, matchesFilter, onEffectHit, ranked, runEffects } from './effects.ts';
import {
  AbilitySlot, ORDER_CAST, ORDER_NONE, SLOT_A1, SLOT_INDEX, SLOT_ITEM1, SLOT_NAMES, SLOT_SPELL1, SLOT_ULT, type Entity, type SourceRef,
} from './entity.ts';
import { breakInvisibility, canCast } from './status.ts';
import { markStatsDirty, computeStats } from './stats.ts';
import { addPassive, fireTrigger, removePassives } from './triggers.ts';
import type { World } from './world.ts';

export type CastResult = 'ok' | 'moving' | 'no_slot' | 'dead' | 'rank' | 'busy' | 'cc' | 'silenced' | 'cooldown' | 'cost' | 'target';
/** channel onTick runs at most this many times in one sim step */
export const MAX_CHANNEL_TICKS_PER_STEP = 16;

// ── slot setup ──────────────────────────────────────────────────────────────────────────────────
/** kit a1..ult + battle spells (`spells[k]` → spell1/spell2; null leaves the slot empty) */
export function setupFighterSlots(w: World, e: Entity, spells: readonly (string | null)[]): void {
  const f = e.fighter;
  if (!f) return;
  const kit = [f.kit.a1, f.kit.a2, f.kit.a3, f.kit.ult];
  for (let i = 0; i < 4; i++) e.slots[SLOT_A1 + i] = new AbilitySlot(SLOT_A1 + i, 'ability', kit[i]);
  for (let k = 0; k < 2; k++) {
    const id = spells[k];
    const def = id ? w.idx.spells.get(id) : undefined;
    if (def) { const s = new AbilitySlot(SLOT_SPELL1 + k, 'spell', def); s.rank = 1; e.slots[SLOT_SPELL1 + k] = s; }
  }
  if (e.player) {
    const list: AbilitySlot[] = [];
    for (let i = 0; i < SLOT_ITEM1; i++) { const s = e.slots[i]; if (s) list.push(s); }
    e.player.abilities = list;
  }
}

/** unit abilities fill a1..ult at rank 1 (unit AI casts them through tryCast) */
export function setupUnitSlots(w: World, e: Entity): void {
  const u = e.unit;
  if (!u) return;
  for (let i = 0; i < Math.min(4, u.abilities.length); i++) {
    const s = new AbilitySlot(SLOT_A1 + i, 'ability', u.abilities[i]);
    s.rank = 1;
    e.slots[SLOT_A1 + i] = s;
  }
}

/** put an item (or nothing) in an item slot: stats, passives, active, consumable charges */
export function equipItem(w: World, e: Entity, index: number, itemId: string | null): void {
  const p = e.player;
  if (!p || index < 0 || index >= 6) return;
  if (p.items[index]) removePassives(w, e, `item:${index}`);
  e.slots[SLOT_ITEM1 + index] = null;
  p.items[index] = itemId;
  p.itemCharges[index] = 0;
  p.itemCooldowns[index] = 0;
  if (itemId) {
    const def = w.idx.items.get(itemId);
    if (!def) throw new Error(`equipItem: unknown item '${itemId}'`);
    for (const pd of def.passives) addPassive(w, e, pd, 'item', `item:${index}`);
    if (def.active) {
      const s = new AbilitySlot(SLOT_ITEM1 + index, 'item', def.active);
      s.rank = 1; s.itemId = itemId;
      e.slots[SLOT_ITEM1 + index] = s;
    }
    if (def.consumable) p.itemCharges[index] = def.consumable.charges;
  }
  markStatsDirty(e);
}

/**
 * Swap two inventory slots WITHOUT re-equipping: the items keep their active's cooldown, charges,
 * recharge and recast state and their passives keep trigger cooldowns (re-equipping would reset
 * all of that — a free refresh from a hotkey). Pure relabelling: slot objects, item arrays and
 * passive keys move together.
 */
export function swapItemSlots(w: World, e: Entity, a: number, b: number): void {
  const p = e.player;
  if (!p || a === b || a < 0 || b < 0 || a >= 6 || b >= 6) return;
  const ia = SLOT_ITEM1 + a, ib = SLOT_ITEM1 + b;
  const sa = e.slots[ia], sb = e.slots[ib];
  e.slots[ia] = sb; e.slots[ib] = sa;
  if (sb) { sb.index = ia; sb.slot = SLOT_NAMES[ia]; }
  if (sa) { sa.index = ib; sa.slot = SLOT_NAMES[ib]; }
  const it = p.items[a]; p.items[a] = p.items[b]; p.items[b] = it;
  const ch = p.itemCharges[a]; p.itemCharges[a] = p.itemCharges[b]; p.itemCharges[b] = ch;
  const cd = p.itemCooldowns[a]; p.itemCooldowns[a] = p.itemCooldowns[b]; p.itemCooldowns[b] = cd;
  const ka = `item:${a}`, kb = `item:${b}`;
  for (const pi of e.passives) { if (pi.key === ka) pi.key = kb; else if (pi.key === kb) pi.key = ka; }
  markStatsDirty(e);
}

/** an item active's timing state, to carry across an unequip/re-equip of the same item (shop undo) */
export interface ItemSlotTimer { item: string; at: number; cooldown: number; charges: number | undefined; rechargeTimer: number }
export function itemSlotTimer(w: World, e: Entity, index: number): ItemSlotTimer | null {
  const s = e.slots[SLOT_ITEM1 + index];
  if (!s || !s.itemId) return null;
  return { item: s.itemId, at: w.time, cooldown: s.cooldown, charges: s.charges, rechargeTimer: s.rechargeTimer };
}
/** re-apply a saved timer to the item now in `index` (if it is the same item), minus the time since */
export function restoreItemSlotTimer(w: World, e: Entity, index: number, t: ItemSlotTimer | null): void {
  const s = e.slots[SLOT_ITEM1 + index];
  if (!t || !s || s.itemId !== t.item) return;
  const dt = Math.max(0, w.time - t.at);
  s.cooldown = Math.max(0, t.cooldown - dt);
  if (s.maxCharges !== undefined && t.charges !== undefined) {
    s.charges = t.charges;
    s.rechargeTimer = s.charges < s.maxCharges ? Math.max(1e-6, t.rechargeTimer - dt) : 0;
  }
  if (e.player) e.player.itemCooldowns[index] = s.cooldown;
}

// ── numbers ─────────────────────────────────────────────────────────────────────────────────────
/** effective rank: ability rank for kit/unit slots; min(level, maxRank) for spells and items */
export function slotRank(e: Entity, s: AbilitySlot): number {
  if (s.kind === 'ability') return s.rank;
  return Math.max(1, Math.min(e.level, s.def.maxRank));
}
function hasteMul(e: Entity, s: AbilitySlot): number {
  return s.kind === 'ability' ? 100 / (100 + Math.max(-99, e.stats.haste)) : 1;
}
export function cooldownOf(e: Entity, s: AbilitySlot, def: AbilityCoreT): number {
  return ranked(def.cooldown, Math.max(1, slotRank(e, s))) * hasteMul(e, s);
}
function rechargeOf(e: Entity, s: AbilitySlot, def: AbilityCoreT): number {
  return def.charges ? ranked(def.charges.recharge, Math.max(1, slotRank(e, s))) * hasteMul(e, s) : 0;
}
export function costOf(e: Entity, s: AbilitySlot, def: AbilityCoreT): number {
  return ranked(def.cost, Math.max(1, slotRank(e, s)));
}
export function rankCap(w: World, e: Entity, s: AbilitySlot): number {
  const max = s.baseDef.maxRank;
  const ar = w.rules.abilityRanks;
  if (s.index === SLOT_ULT) {
    let n = 0;
    for (const l of ar.ultLevels) if (e.level >= l) n++;
    return Math.min(max, n);
  }
  return Math.min(max, ar.basicMax, Math.ceil(e.level / 2));
}

function affordable(e: Entity, s: AbilitySlot, def: AbilityCoreT): 'ok' | 'cost' {
  const cost = costOf(e, s, def);
  if (def.costKind === 'none' || cost <= 0) return def.costKind === 'res' && e.resource?.model === 'heat' && e.overheat > 0 ? 'cost' : 'ok';
  if (def.costKind === 'hp') return e.hp > cost ? 'ok' : 'cost';
  const r = e.resource;
  if (!r || r.model === 'none') return 'ok';
  if (r.model === 'heat') return e.overheat > 0 ? 'cost' : 'ok';
  return e.res + 1e-9 >= cost ? 'ok' : 'cost';
}
function payCost(e: Entity, s: AbilitySlot, def: AbilityCoreT): boolean {
  if (affordable(e, s, def) !== 'ok') return false;
  const cost = costOf(e, s, def);
  if (cost <= 0 || def.costKind === 'none') return true;
  if (def.costKind === 'hp') { e.hp -= cost; return true; }
  const r = e.resource;
  if (!r || r.model === 'none') return true;
  if (r.model === 'heat') {
    e.res = Math.min(e.maxRes, e.res + cost);
    e.resIdle = 0;
    if (e.res >= e.maxRes - 1e-9) e.overheat = r.overheatLock ?? 2;
    return true;
  }
  e.res -= cost;
  e.resIdle = 0;
  return true;
}

// ── casting ─────────────────────────────────────────────────────────────────────────────────────
function sourceOf(s: AbilitySlot, def: AbilityCoreT): SourceRef {
  return { kind: s.kind === 'ability' ? 'ability' : s.kind === 'spell' ? 'spell' : 'item', id: def.id };
}

/** is the target/point within cast range (unit: centre distance ≤ range + target radius) */
export function castInRange(e: Entity, def: AbilityCoreT, target: Entity | null, x: number, y: number): boolean {
  const tk = def.targeting.kind;
  if (tk === 'unit') {
    if (!target) return false;
    const r = (def.targeting.range > 0 ? def.targeting.range : e.radius + 0.5) + target.radius;
    const dx = target.x - e.x, dy = target.y - e.y;
    return dx * dx + dy * dy <= r * r;
  }
  if (tk === 'point') {
    const r = def.targeting.range;
    if (r <= 0) return true;
    const dx = x - e.x, dy = y - e.y;
    return dx * dx + dy * dy <= r * r + 1e-6;
  }
  return true;
}

/** gate checks shared by tryCast and the HUD's `ready` flag */
function gate(w: World, e: Entity, s: AbilitySlot): CastResult {
  if (!e.alive) return 'dead';
  if (s.kind === 'ability' && s.rank <= 0) return 'rank';
  if (e.cast || e.dash) return 'busy';
  if (!canCast(e, s.kind)) return canCast(e, 'spell') ? 'silenced' : 'cc';
  if (s.recastDef) { if (s.recastLock > 0) return 'cooldown'; }
  else if (s.def.charges) { if ((s.charges ?? 0) <= 0 || s.cooldown > 0) return 'cooldown'; }
  else if (s.cooldown > 0) return 'cooldown';
  return affordable(e, s, s.def);
}

/**
 * Issue a cast from a slot. Returns 'ok' when the windup started (or the cast resolved),
 * 'moving' when the caster walks into range first, or the reason it was refused.
 */
export function tryCast(w: World, e: Entity, slotIndex: number, x?: number, y?: number, targetId?: EntityId): CastResult {
  const s = slotIndex >= 0 ? e.slots[slotIndex] : null;
  if (!s) return 'no_slot';
  const g = gate(w, e, s);
  if (g !== 'ok') return g;
  const def = s.def;
  const tk = def.targeting.kind;
  let target: Entity | null = null;
  let px = x ?? e.x + Math.cos(e.facing), py = y ?? e.y + Math.sin(e.facing);
  if (tk === 'unit') {
    target = targetId !== undefined ? w.live(targetId) : null;
    if (!target) return 'target';
    if (!matchesFilter(w, e, target, def.targeting.filter)) return 'target';
    if (w.relation(e, target) === 2 && e.team >= 0 && (target.visibleMask & (1 << e.team)) === 0) return 'target';
    px = target.x; py = target.y;
  } else if (tk === 'self') {
    target = e;
    if (x === undefined) { px = e.x; py = e.y; }
  } else if (tk === 'point') {
    if (def.targeting.minRange) {
      const dx = px - e.x, dy = py - e.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < def.targeting.minRange) {
        const ux = d > 1e-6 ? dx / d : Math.cos(e.facing), uy = d > 1e-6 ? dy / d : Math.sin(e.facing);
        px = e.x + ux * def.targeting.minRange; py = e.y + uy * def.targeting.minRange;
      }
    }
    // a ground target is on the map (an off-map point could never be walked into range)
    const S = w.mapDef.size;
    px = Math.max(0, Math.min(S[0] - 1e-3, px)); py = Math.max(0, Math.min(S[1] - 1e-3, py));
  }
  if (!castInRange(e, def, target, px, py)) {
    e.order = ORDER_CAST;
    e.pendingSlot = slotIndex; e.pendingX = px; e.pendingY = py; e.pendingTarget = target ? target.id : -1;
    e.path.length = 0; e.pathGoalX = NaN;
    return 'moving';
  }
  startCast(w, e, s, def, target, px, py);
  return 'ok';
}

function startCast(w: World, e: Entity, s: AbilitySlot, def: AbilityCoreT, target: Entity | null, px: number, py: number): void {
  const ctx = makeCtx(e, sourceOf(s, def), Math.max(1, slotRank(e, s)), target, px, py, def.present, s.slot);
  if (def.targeting.kind !== 'none' && def.targeting.kind !== 'self') e.facing = Math.atan2(ctx.dy, ctx.dx);
  e.atkWindup = -1;
  e.atkAnim = 0;
  if (e.order === ORDER_CAST) { e.order = ORDER_NONE; e.pendingSlot = -1; }
  e.cast = { slot: s, def, ctx, phase: 'windup', t: 0, dur: def.castTime, tickAcc: 0, recast: s.recastDef !== null, targetLife: target ? target.lifeSeq : 0 };
  e.actionSeq++;
  w.emit({ e: 'cast', t: w.time, src: e.id, slot: s.slot, ability: def.id, x: px, y: py, target: target ? target.id : undefined, castTime: def.castTime });
  if (def.castTime <= 0) releaseCast(w, e);
}

const deliveryCache = new WeakMap<object, boolean>();
/** does the top-level list deliver itself (projectile/dash/area/zone)? then the delivery emits hits */
function delivers(def: AbilityCoreT): boolean {
  let v = deliveryCache.get(def);
  if (v === undefined) {
    v = def.effects.some((x) => x.op === 'projectile' || x.op === 'dash' || x.op === 'area' || x.op === 'zone');
    deliveryCache.set(def, v);
  }
  return v;
}

/** windup finished: pay, start cooldown, fire effects (or begin the channel) */
function releaseCast(w: World, e: Entity): void {
  const cs = e.cast;
  if (!cs) return;
  const s = cs.slot, def = cs.def, ctx = cs.ctx;
  // a unit-targeted cast whose target died, left the store or became untargetable during the
  // windup fizzles like a CC-cancelled windup: nothing is paid, no cooldown, no hit on a corpse
  if (def.targeting.kind === 'unit') {
    const t = ctx.target;
    if (!t || t.removed || !t.alive || t.lifeSeq !== cs.targetLife || (t !== e && !t.targetable)) { e.cast = null; return; }
  }
  if (s && !payCost(e, s, def)) { e.cast = null; return; }
  if (s) commitCooldown(w, e, s, def, cs.recast);
  breakInvisibility(w, e);
  if (def.channel) {
    cs.phase = 'channel'; cs.t = 0; cs.dur = def.channel.duration; cs.tickAcc = 0;
    e.actionSeq++;
  } else {
    e.cast = null;
    const t = ctx.target;
    if (def.targeting.kind === 'unit' && t && t !== e && !delivers(def)) onEffectHit(w, ctx, t);
    runEffects(w, def.effects, ctx);
  }
  if (s && s.kind === 'ability') fireTrigger(w, e, 'abilityCast', ctx.target, 0);
  if (s && s.kind === 'item') consumeItemCharge(w, e, s);
}

function consumeItemCharge(w: World, e: Entity, s: AbilitySlot): void {
  const p = e.player;
  // the slot must still hold this item's active (the shop cancels casts of items it removes;
  // this guards any other path from spending a charge of whatever sits there now)
  if (!p || !s.itemId || e.slots[s.index] !== s) return;
  const idx = s.index - SLOT_ITEM1;
  const def = w.idx.items.get(s.itemId);
  if (!def || !def.consumable) return;
  p.itemCharges[idx]--;
  if (p.itemCharges[idx] <= 0) equipItem(w, e, idx, null);
}

function commitCooldown(w: World, e: Entity, s: AbilitySlot, def: AbilityCoreT, isRecast: boolean): void {
  const zero = w.noCooldowns;
  if (isRecast) {
    // recast used: the slot returns to its record and the deferred cooldown starts now
    closeRecast(w, e, s);
    return;
  }
  const rc = (def as AbilityDefT).recast;
  if (def.charges) {
    s.charges = Math.max(0, (s.charges ?? def.charges.max) - 1);
    if (s.rechargeTimer <= 0 && s.charges < def.charges.max) s.rechargeTimer = zero ? 0 : rechargeOf(e, s, def);
  }
  const cd = zero ? 0 : cooldownOf(e, s, def);
  if (rc) {
    s.deferredCd = cd;
    s.recastDef = rc.ability;
    s.recastFrom = def;
    s.def = rc.ability; s.id = rc.ability.id;
    s.recastWindow = rc.window;
    s.recastLock = zero ? 0 : ranked(rc.ability.cooldown, Math.max(1, slotRank(e, s)));
    s.cooldown = 0;
    s.cooldownMax = cd;
    return;
  }
  s.cooldown = cd;
  s.cooldownMax = def.charges && s.rechargeTimer > 0 ? Math.max(cd, s.rechargeTimer) : cd;
}

function closeRecast(w: World, e: Entity, s: AbilitySlot): void {
  if (!s.recastDef) return;
  s.recastDef = null;
  s.recastFrom = null;
  s.recastWindow = undefined;
  s.recastLock = 0;
  const back = s.formDef ?? s.baseDef;
  s.def = back; s.id = back.id;
  s.cooldown = w.noCooldowns ? 0 : s.deferredCd;
  s.cooldownMax = s.deferredCd;
  s.deferredCd = 0;
}

/** swap the record a slot casts (forms); cooldowns of swapped-out records keep ticking in the stash */
export function swapSlotDef(s: AbilitySlot, def: AbilityCoreT): void {
  if (s.def === def && !s.recastDef) return;
  let cur = s.def;
  if (s.recastDef) {
    // an open recast window closes; its deferred cooldown belongs to the record that opened it
    cur = s.recastFrom ?? s.baseDef;
    s.cooldown = s.deferredCd;
    s.recastDef = null; s.recastFrom = null; s.recastWindow = undefined; s.recastLock = 0; s.deferredCd = 0;
  }
  if (s.cooldown > 0) (s.stash ??= new Map()).set(cur.id, s.cooldown);
  s.def = def; s.id = def.id;
  const prev = s.stash?.get(def.id);
  s.cooldown = prev ?? 0;
  if (prev !== undefined) s.stash!.delete(def.id);
  if (def.charges) { s.maxCharges = def.charges.max; if (s.charges === undefined) s.charges = def.charges.max; }
  else { s.maxCharges = undefined; s.charges = undefined; }
}

/**
 * Cancel the current windup/channel. byCC: hard CC or silence (non-interruptible channels
 * survive it); otherwise the caster chose to (move order) or died.
 */
export function interruptCast(w: World, e: Entity, byCC: boolean): void {
  const cs = e.cast;
  if (!cs) return;
  if (cs.phase === 'channel' && byCC && cs.def.channel && cs.def.channel.interruptible === false) return;
  e.cast = null;
}

/** the 'casts' phase: windups, channels, casts waiting for range */
export function castSystem(w: World): void {
  const list = w.entities;
  const dt = TICK_DT;
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (!e.alive) continue;
    if (e.order === ORDER_CAST && !e.cast) {
      const s = e.slots[e.pendingSlot];
      const tgt = e.pendingTarget >= 0 ? w.live(e.pendingTarget) : null;
      if (!s || (e.pendingTarget >= 0 && !tgt)) { e.order = ORDER_NONE; e.pendingSlot = -1; }
      else {
        const px = tgt ? tgt.x : e.pendingX, py = tgt ? tgt.y : e.pendingY;
        if (castInRange(e, s.def, tgt, px, py)) {
          const r = tryCast(w, e, e.pendingSlot, px, py, tgt ? tgt.id : undefined);
          if (r !== 'ok' && r !== 'moving' && r !== 'busy' && r !== 'cc' && r !== 'silenced') { e.order = ORDER_NONE; e.pendingSlot = -1; }
        }
      }
    }
    const cs = e.cast;
    if (!cs) continue;
    if (cs.phase === 'windup') {
      cs.t += dt;
      if (cs.t + 1e-9 >= cs.dur) releaseCast(w, e);
      continue;
    }
    // channel
    cs.t += dt;
    const ch = cs.def.channel!;
    if (ch.interval && ch.onTick) {
      cs.tickAcc += dt;
      // sub-tick intervals run several times per tick; the cap keeps a typo (1e-6) from hanging the sim
      for (let n = 0; cs.tickAcc + 1e-9 >= ch.interval && e.cast === cs && n < MAX_CHANNEL_TICKS_PER_STEP; n++) {
        cs.tickAcc -= ch.interval;
        runEffects(w, ch.onTick, cs.ctx);
      }
      if (cs.tickAcc > ch.interval) cs.tickAcc = ch.interval;
    }
    if (e.cast === cs && cs.t + 1e-9 >= cs.dur) {
      e.cast = null;
      runEffects(w, cs.def.effects, cs.ctx);
    }
  }
}

// ── per-tick slot bookkeeping ───────────────────────────────────────────────────────────────────
export function tickSlots(w: World, e: Entity, dt: number): void {
  const p = e.player;
  for (let i = 0; i < e.slots.length; i++) {
    const s = e.slots[i];
    if (!s) continue;
    if (s.cooldown > 0) { s.cooldown -= dt; if (s.cooldown < 0) s.cooldown = 0; }
    if (s.stash && s.stash.size > 0) {
      for (const [k, v] of s.stash) { const nv = v - dt; if (nv <= 0) s.stash.delete(k); else s.stash.set(k, nv); }
    }
    const ch = s.def.charges;
    if (ch && s.charges !== undefined && s.charges < ch.max) {
      s.rechargeTimer -= dt;
      if (s.rechargeTimer <= 1e-9) {
        s.charges++;
        s.rechargeTimer = s.charges < ch.max ? s.rechargeTimer + rechargeOf(e, s, s.def) : 0;
      }
    }
    if (s.recastDef) {
      s.recastLock -= dt;
      s.recastWindow = (s.recastWindow ?? 0) - dt;
      if (s.recastWindow <= 1e-9 && !(e.cast && e.cast.slot === s)) closeRecast(w, e, s);
    }
    // view fields
    if (s.kind !== 'ability') s.rank = slotRank(e, s);
    s.cost = costOf(e, s, s.def);
    s.ready = gate(w, e, s) === 'ok';
    s.canLevel = !!p && i <= SLOT_ULT && p.skillPoints > 0 && s.rank < rankCap(w, e, s);
    if (p && i >= SLOT_ITEM1) p.itemCooldowns[i - SLOT_ITEM1] = s.cooldown;
  }
}

/** reduce cooldowns (DSL `cooldown` op): seconds and/or percent of the remaining time */
export function reduceCooldown(w: World, e: Entity, slot: SlotT | 'all_abilities', seconds?: number, percent?: number): void {
  if (slot === 'passive') {
    for (const p of e.passives) {
      if (p.key !== 'kit') continue;
      for (const t of p.triggers) t.cd = reduce(t.cd, seconds, percent);
    }
    return;
  }
  const from = slot === 'all_abilities' ? SLOT_A1 : SLOT_INDEX[slot];
  const to = slot === 'all_abilities' ? SLOT_ULT : from;
  for (let i = from; i <= to; i++) {
    const s = e.slots[i];
    if (!s) continue;
    s.cooldown = reduce(s.cooldown, seconds, percent);
    if (s.rechargeTimer > 0) s.rechargeTimer = Math.max(1e-6, reduce(s.rechargeTimer, seconds, percent));
    if (s.deferredCd > 0) s.deferredCd = reduce(s.deferredCd, seconds, percent);
  }
}
function reduce(v: number, seconds?: number, percent?: number): number {
  if (percent !== undefined) v -= v * percent;
  if (seconds !== undefined) v -= seconds;
  return v < 0 ? 0 : v;
}

// ── levels ──────────────────────────────────────────────────────────────────────────────────────
export function levelUpAbility(w: World, e: Entity, slot: 'a1' | 'a2' | 'a3' | 'ult'): boolean {
  const s = e.slots[SLOT_INDEX[slot]];
  const p = e.player;
  if (!s || !p || p.skillPoints <= 0) return false;
  if (s.rank >= rankCap(w, e, s)) return false;
  s.rank++;
  p.skillPoints--;
  s.canLevel = p.skillPoints > 0 && s.rank < rankCap(w, e, s);
  return true;
}

/** set an entity's level (economy XP, practice). Gains grant skill points and fire levelUp. */
export function setLevel(w: World, e: Entity, level: number): void {
  const lv = Math.max(1, Math.min(w.rules.maxLevel, Math.floor(level)));
  const gained = lv - e.level;
  if (gained === 0) return;
  e.level = lv;
  markStatsDirty(e);
  computeStats(w, e);
  if (gained > 0) {
    if (e.player) {
      e.player.skillPoints += gained;
      w.emit({ e: 'levelUp', t: w.time, player: e.player.player, level: lv });
    }
    for (let i = 0; i < gained; i++) fireTrigger(w, e, 'levelUp', null, 0);
  }
}

