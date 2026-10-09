// GENESIS — a settlement's store (CONTRACT.md §8.5, §8.6): one stockpile of quantities per item, filled by gatherers,
// hunters, farmers and crafters, drawn on by eaters, builders and crafters. Capacity comes from storage buildings;
// overflow and perishables rot (rotting grain is an accident trigger: beer). Food is measured in days for the
// settlement's own species.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';

export function storeAdd(x: PCtx, st: Settlement, item: number, qty: number): void {
  if (qty <= 0 || item < 0) return;
  while (st.store.length <= item) st.store.push(0);
  st.store[item] = round3(st.store[item] + qty);
}

/** take up to qty; returns what was taken */
export function storeTake(st: Settlement, item: number, qty: number): number {
  const have = st.store[item] ?? 0;
  const got = Math.min(have, qty);
  if (got > 0) st.store[item] = round3(have - got);
  return got;
}

export function storeHas(st: Settlement, item: number): number {
  return st.store[item] ?? 0;
}

/** total of any of these items */
export function storeAny(st: Settlement, items: number[]): number {
  let q = 0;
  for (const i of items) q += st.store[i] ?? 0;
  return q;
}

/** take `qty` spread over acceptable items (first listed first); returns what was taken */
export function storeTakeAny(st: Settlement, items: number[], qty: number): number {
  let got = 0;
  for (const i of items) {
    if (got >= qty) break;
    got += storeTake(st, i, qty - got);
  }
  return got;
}

/** days of food in the store for one member of the settlement's species */
export function foodDays(x: PCtx, st: Settlement): number {
  const ed = x.info[st.species].edible;
  let d = 0;
  for (let i = 0; i < st.store.length; i++) if (st.store[i] > 0 && ed[i] > 0) d += st.store[i] * ed[i];
  return d;
}

/** the best food in the store for this species (index) or -1 */
export function bestFood(x: PCtx, st: Settlement): number {
  const sp = x.info[st.species];
  for (const i of sp.foods) if ((st.store[i] ?? 0) >= 0.25) return i;
  return -1;
}

export function stored(st: Settlement): number {
  let q = 0;
  for (let i = 0; i < st.store.length; i++) q += st.store[i];
  return q;
}

/** storage capacity (units) of the settlement's complete buildings + a base pile */
export function capacity(x: PCtx, st: Settlement): number {
  let cap = 120;
  for (const b of x.ps.of(st.id)) if (b.progress >= 1 && b.damage < 0.9) cap += x.c.buildings.list[b.type].storage;
  return cap;
}

/**
 * Daily spoilage. Returns the units of grain that rotted (the brewing accident trigger). Granaries halve grain loss;
 * salt and smoke already made preserved foods slow to spoil (item decay).
 */
export function spoil(x: PCtx, st: Settlement, granary: boolean, cap: number): number {
  let rotGrain = 0;
  const total = stored(st);
  const over = total > cap ? Math.min(0.15, (total - cap) / Math.max(1, total)) : 0;
  for (let i = 0; i < st.store.length; i++) {
    const q = st.store[i];
    if (q <= 0) continue;
    const it = x.c.items.list[i];
    let d = (it.decay ?? 0) + (it.food ? over : 0);
    const grain = it.tags.includes('grain');
    if (grain && granary) d *= 0.4;
    if (d <= 0) continue;
    const lost = q * Math.min(1, d);
    st.store[i] = round3(q - lost);
    if (grain) rotGrain += lost;
  }
  return rotGrain;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
