// Inventory: 10 hotbar + 40 main slots (research 04 §1), 3 armor slots.
// Money is a single integer in copper (1.4.4 note in research 04: "store as one
// integer" — dedicated coin slots are a UI nicety we skip in v1).

import { ITEMS } from './items.js';

export const HOTBAR = 10, MAIN = 40, SLOTS = HOTBAR + MAIN;

export class Inventory {
  constructor() {
    this.slots = new Array(SLOTS).fill(null);   // {id, count} | null
    this.armor = { head: null, chest: null, legs: null };
    this.selected = 0;                           // hotbar index
    this.money = 0;                              // copper coins
    this.onChange = [];
  }

  changed() { for (const fn of this.onChange) fn(this); }

  held() { return this.slots[this.selected]; }
  heldDef() { const s = this.held(); return s ? ITEMS[s.id] : null; }

  defense() {
    let d = 0;
    for (const k of ['head', 'chest', 'legs']) if (this.armor[k]) d += ITEMS[this.armor[k].id].defense ?? 0;
    // set bonus: all three pieces share a tier prefix → +bonus (research 04 §6, simplified to +2/-ish handled in player)
    return d;
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
