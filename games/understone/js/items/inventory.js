// Inventory: 10 hotbar + 40 main slots (research 04 §1), 3 armor slots.
// Money is a single integer in copper (1.4.4 note in research 04: "store as one
// integer" — dedicated coin slots are a UI nicety we skip in v1).

import { ITEMS } from './items.js';

export const HOTBAR = 10, MAIN = 40, SLOTS = HOTBAR + MAIN;

export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'];
export const ACCESSORY_SLOTS = 5;
export const HAND_SLOTS = ['mainhand', 'offhand'];

// items that emit light when HELD (selected) or worn in the off-hand — [r,g,b] 0..1
export const HELD_LIGHTS = {
  torch: [1.0, 0.78, 0.46], lantern: [1.0, 0.86, 0.62], candle: [0.85, 0.62, 0.36],
};
const MELEE_OR_RANGED = new Set(['sword', 'shortsword', 'spear', 'flail', 'bow', 'magic', 'boomerang']);

export class Inventory {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);   // {id, count} | null
    this.armor = { head: null, chest: null, legs: null, feet: null };
    this.accessories = new Array(ACCESSORY_SLOTS).fill(null); // rings/charms/boots-effects
    this.hands = { mainhand: null, offhand: null }; // wielded weapon/tool + off-hand light/shield
    this.selected = 0;                           // hotbar index
    this.money = 0;                              // copper coins
    this.onChange = [];
  }

  // light emitted by a HELD torch/lantern (off-hand slot, or the selected hotbar item — Terraria
  // lights the area around you when you hold a torch). Returns [r,g,b] or null.
  heldLight() {
    const off = this.hands.offhand;
    if (off && HELD_LIGHTS[off.id]) return HELD_LIGHTS[off.id];
    const sel = this.held();
    if (sel && HELD_LIGHTS[sel.id]) return HELD_LIGHTS[sel.id];
    return null;
  }

  changed() { for (const fn of this.onChange) fn(this); }

  held() { return this.slots[this.selected]; }
  heldDef() { const s = this.held(); return s ? ITEMS[s.id] : null; }

  // does an equip slot accept this item?
  slotAccepts(slotKind, itemId) {
    const def = ITEMS[itemId];
    if (!def) return false;
    if (ARMOR_SLOTS.includes(slotKind)) return def.type === 'armor' && def.bodySlot === slotKind;
    if (slotKind === 'accessory') return def.type === 'accessory';
    if (slotKind === 'mainhand') return def.type === 'tool' || MELEE_OR_RANGED.has(def.weapon);
    if (slotKind === 'offhand') return def.type === 'accessory' || HELD_LIGHTS[itemId] != null;
    return false;
  }

  // aggregate accessory effects (industry-standard paper-doll bonuses)
  accessoryEffects() {
    const e = { moveSpeed: 1, regen: 0, extraJumps: 0, noFallDamage: false, defense: 0, critBonus: 0 };
    for (const a of this.accessories) {
      if (!a) continue;
      const d = ITEMS[a.id];
      if (!d?.accessory) continue;
      e.moveSpeed *= d.accessory.moveSpeed ?? 1;
      e.regen += d.accessory.regen ?? 0;
      e.extraJumps += d.accessory.extraJumps ?? 0;
      e.defense += d.accessory.defense ?? 0;
      e.critBonus += d.accessory.critBonus ?? 0;
      if (d.accessory.noFallDamage) e.noFallDamage = true;
    }
    return e;
  }

  defense() {
    let d = this.accessoryEffects().defense;
    for (const k of ARMOR_SLOTS) if (this.armor[k]) d += ITEMS[this.armor[k].id].defense ?? 0;
    // set bonus (research 04 §6): matching tier prefix on all three pieces
    const SET_BONUS = { wood: 1, copper: 2, iron: 2, silver: 3, gold: 3, molten: 0, shadow: 0 };
    const prefixOf = (id) => id.replace(/(Helmet|Breastplate|Greaves|Chainmail|Scalemail).*/, '');
    if (this.armor.head && this.armor.chest && this.armor.legs) {
      const p = prefixOf(this.armor.head.id);
      if (p === prefixOf(this.armor.chest.id) && p === prefixOf(this.armor.legs.id)) {
        d += SET_BONUS[p] ?? 0;   // molten/shadow bonuses are non-defense (dmg/speed) — v1 skips those effects
      }
    }
    return d;
  }

  // Terraria-style soft classes: full armor sets buff a damage type
  classBonus() {
    const b = { meleeDmg: 1, rangedDmg: 1, magicDmg: 1, manaCost: 1, meleeSpeed: 1 };
    const { head, chest, legs } = this.armor;
    if (!head || !chest || !legs) return b;
    const prefixOf = (id) => id.replace(/(Helmet|Breastplate|Greaves|Chainmail|Scalemail|Hat|Shirt|Pants|Hood|Jerkin|Leggings).*/, '');
    const p = prefixOf(head.id);
    if (p !== prefixOf(chest.id) || p !== prefixOf(legs.id)) return b;
    if (p === 'molten') b.meleeDmg = 1.1;        // warrior
    else if (p === 'shadow') b.meleeSpeed = 0.85; // rogue-ish: +15% swing speed
    else if (p === 'jungle') { b.manaCost = 0.84; b.magicDmg = 1.08; } // mage
    else if (p === 'ranger') b.rangedDmg = 1.15; // archer
    return b;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  // add items; returns leftover that didn't fit
  add(id, count = 1) {
    const def = ITEMS[id];
    if (!def) return count;
    const max = def.stack ?? 9999;
    // top up existing stacks first
    for (let i = 0; i < SLOTS && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max) {
        const take = Math.min(max - s.count, count);
        s.count += take; count -= take;
      }
    }
    // then empty slots (hotbar first)
    for (let i = 0; i < SLOTS && count > 0; i++) {
      if (!this.slots[i]) {
        const take = Math.min(max, count);
        this.slots[i] = { id, count: take };
        count -= take;
      }
    }
    this.changed();
    return count;
  }

  // remove count of id; returns true if fully removed (no partial removal on failure)
  remove(id, count = 1) {
    if (this.count(id) < count) return false;
    for (let i = SLOTS - 1; i >= 0 && count > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const take = Math.min(s.count, count);
        s.count -= take; count -= take;
        if (s.count === 0) this.slots[i] = null;
      }
    }
    this.changed();
    return true;
  }

  consumeHeld(n = 1) {
    const s = this.held();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  firstAmmo(ammoType) {
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i];
      if (s && ITEMS[s.id].type === 'ammo' && ITEMS[s.id].ammoType === ammoType) return s;
    }
    return null;
  }

  consumeAmmo(stack) {
    stack.count--;
    if (stack.count <= 0) {
      const i = this.slots.indexOf(stack);
      if (i >= 0) this.slots[i] = null;
    }
    this.changed();
  }
}

export function coinText(copper) {
  const gold = Math.floor(copper / 10000), silver = Math.floor((copper % 10000) / 100), c = copper % 100;
  const parts = [];
  if (gold) parts.push(`${gold}g`);
  if (silver) parts.push(`${silver}s`);
  parts.push(`${c}c`);
  return parts.join(' ');
}
