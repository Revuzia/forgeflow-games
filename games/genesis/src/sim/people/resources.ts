// GENESIS — what a settlement can reach (CONTRACT.md §8.3, §8.5): resource availability per cell from the fields
// (vegetation by species, ores, sand, snow, water, the air), the settlement's resource cache (best cells per item,
// drinking water, fishing water, free fertile land, danger, contexts) and its flow field. Both are recomputed at fixed
// ticks by the settlement step and SAVED, so decisions read exactly the same lists after a load.

import type { PCtx } from './ctx.ts';
import type { Settlement, ResourceCache } from './state.ts';
import { buildFlowField, type PathOpts } from '../grid/pathfind.ts';
import { cellContexts } from './context.ts';
import { drinkable, freshWater, isLand, snowWater, wellFlows } from './world.ts';
import { BuildingFlag } from '../types.ts';
import { animalDef } from '../life/herds.ts';

/** gather task -> items it can yield (the recipe table adds species-specific ones) */
export const GATHER_TASKS = ['forage', 'chop', 'quarry', 'dig', 'mine', 'cut-ice', 'collect-air', 'secrete'] as const;

interface Ids {
  berry: Set<number>; grain: Set<number>; reeds: Set<number>; conifer: Set<number>; flax: Set<number>; nutTree: Set<number>;
  item: Map<string, number>;
  /** item index -> id (no registry lookups in the hot loop) */
  name: string[];
  oreOf: Map<number, number>; // item index -> ore type index + 1
  /** item index -> availability rule (AV_*), so the hot loop switches on a number */
  code: Int8Array;
  /** item index -> ore type + 1 (0 none) */
  ore: Int16Array;
}

// availability rules (an item's id picks its rule once per content)
const AV: Record<string, number> = {
  berries: 1, 'wild-grain': 2, roots: 3, nuts: 4, herbs: 5, honey: 6, fiber: 7, reeds: 8, stick: 9, wood: 10, bark: 11, resin: 12,
  stone: 13, clay: 14, sand: 15, salt: 16, 'ice-block': 17, tholin: 18, fish: 19,
};
const idCache = new WeakMap<object, Ids>();
function ids(x: PCtx): Ids {
  let v = idCache.get(x.c);
  if (!v) {
    const pl = (names: string[]) => new Set(x.c.plants.list.map((p, i) => (names.includes(p.id) ? i : -1)).filter((i) => i >= 0));
    const item = new Map<string, number>();
    x.c.items.list.forEach((it, i) => item.set(it.id, i));
    // items that come out of the ground: ore deposit id -> item
    const oreItem: Record<string, string> = {
      flint: 'flint', clay: 'clay', copper: 'copper-ore', tin: 'tin-ore', iron: 'iron-ore', coal: 'coal', gold: 'gold', silver: 'silver',
      sulfur: 'sulfur', obsidian: 'obsidian', saltpeter: 'saltpeter', salt: 'salt', 'glass-sand': 'sand', oil: 'crude-oil',
    };
    const oreOf = new Map<number, number>();
    x.c.ores.list.forEach((o, i) => { const it = item.get(oreItem[o.id] ?? ''); if (it !== undefined) oreOf.set(it, i + 1); });
    v = {
      berry: pl(['berry-bush']), grain: pl(['wild-grain', 'wild-rice', 'teosinte']), reeds: pl(['reeds']), conifer: pl(['pine', 'spruce']),
      flax: pl(['flax']), nutTree: pl(['oak', 'beech', 'kapok', 'baobab']), item, oreOf, name: x.c.items.list.map((i) => i.id),
      code: Int8Array.from(x.c.items.list.map((i) => AV[i.id] ?? 0)),
      ore: Int16Array.from(x.c.items.list.map((_, i) => oreOf.get(i) ?? 0)),
    };
    idCache.set(x.c, v);
  }
  return v;
}

export function itemIdx(x: PCtx, id: string): number {
  return ids(x).item.get(id) ?? -1;
}

/**
 * How much of item `it` a gatherer finds at cell c (0 none .. ~1 rich). Seasonal plants give nothing while dormant.
 */
export function availability(x: PCtx, it: number, c: number): number {
  const I = ids(x);
  if (it < 0 || it >= I.code.length) return 0;
  return availOf(x, I, I.code[it], I.ore[it], c);
}

/** availability by rule code (see AV) and ore type + 1 of an item at cell c */
function availOf(x: PCtx, I: Ids, code: number, ore: number, c: number): number {
  const p = x.p, f = p.f;
  const warm = f.temperature[c] > 4;
  const land = isLand(p, c);
  let v = 0;
  if (ore > 0 && f.oreType[c] === ore) v = 0.25 + 0.75 * f.ore[c];
  switch (code) {
    case 1: return land && warm && I.berry.has(f.shrubSpecies[c]) ? f.shrub[c] : 0;
    case 2: return land && warm && I.grain.has(f.grassSpecies[c]) ? f.grass[c] : 0;
    case 3: return land && f.soil[c] > 0.1 ? (f.grass[c] + f.shrub[c]) * 0.45 : 0;
    case 4: return land && warm ? f.tree[c] * (I.nutTree.has(f.treeSpecies[c]) ? 0.6 : 0.15) : 0;
    case 5: return land && warm ? f.shrub[c] * 0.3 + f.grass[c] * 0.15 : 0;
    case 6: return land && f.temperature[c] > 10 ? f.tree[c] * 0.12 : 0;
    case 7: return land ? f.grass[c] * 0.4 + f.shrub[c] * 0.25 + (I.flax.has(f.cropSpecies[c]) ? f.crop[c] : 0) : 0;
    case 8: return I.reeds.has(f.grassSpecies[c]) ? f.grass[c] : f.water[c] > 0.04 && f.water[c] < 0.8 ? f.grass[c] * 0.4 : 0;
    case 9: return land ? f.tree[c] * 0.5 + f.shrub[c] * 0.4 : 0;
    case 10: return land ? f.tree[c] : 0;
    case 11: return land ? f.tree[c] * 0.5 : 0;
    case 12: return land ? f.tree[c] * (I.conifer.has(f.treeSpecies[c]) ? 0.6 : 0.1) : 0;
    case 13: return land ? Math.max(v, f.soil[c] < 0.4 ? 0.3 + (0.4 - f.soil[c]) * 1.5 : f.surface[c] - p.st.seaLevel > 150 ? 0.4 : 0.08) : 0;
    case 14: return Math.max(v, f.soil[c] > 0.3 && f.water[c] > 0.02 && f.water[c] < 1 ? 0.35 : 0);
    case 15: return Math.max(v, Math.min(1, f.sand[c] / 1.2) * (f.water[c] < 0.5 ? 1 : 0.3));
    case 16: return Math.max(v, f.salinity[c] > 0.5 && f.water[c] < 0.3 && p.s.coast[c] ? 0.2 : 0);
    case 17: return f.snow[c] > 0.2 || f.ice[c] > 0.1 || p.s.seaIce[c] > 0.05 ? Math.min(1, f.snow[c] + f.ice[c] + p.s.seaIce[c]) : 0;
    case 18: { const a = p.st.atmosphere; return a.methane * a.pressure >= 0.02 ? 0.7 : 0; }
    case 19: return f.water[c] > 0.3 ? Math.min(1, 0.25 + f.water[c] * 0.08) : 0;
    default: return land || ore > 0 ? v : 0;
  }
}

/** the items a settlement knows how to gather, by task */
export function gatherable(x: PCtx, st: Settlement): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const k of st.library) {
    const r = x.rt.list[k];
    if (!r || !r.gatherTask) continue;
    let l = out.get(r.gatherTask);
    if (!l) out.set(r.gatherTask, (l = []));
    for (const it of r.gatherItems) if (!l.includes(it)) l.push(it);
  }
  // anyone can pick up stones, sticks and fallen wood
  const basics = ['stone', 'stick', 'wood'];
  for (const b of basics) {
    const it = itemIdx(x, b);
    if (it < 0) continue;
    const task = b === 'stone' ? 'quarry' : 'chop';
    let l = out.get(task);
    if (!l) out.set(task, (l = []));
    if (!l.includes(it)) l.push(it);
  }
  for (const l of out.values()) l.sort((a, b) => a - b);
  return out;
}

const _ctx = new Set<string>();

/** cells of the settlement's reach (its flow field), else rings around the centre */
export function reachCells(x: PCtx, st: Settlement, rings: number): number[] {
  if (st.flow && st.flow.cells.length) return st.flow.cells;
  const g = x.p.grid;
  const seen = new Set<number>([st.cell]);
  let fr = [st.cell];
  for (let d = 0; d < rings; d++) {
    const nf: number[] = [];
    for (const c of fr) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    fr = nf;
  }
  return [...seen].sort((a, b) => a - b);
}

/** the farthest a routine trip goes from home, in flow-field cost (metres × terrain factor) */
export const MAX_WORK_COST = 280;

/** compare two costs that may be Infinity (a plain subtraction gives NaN and an unstable sort) */
export function cmpCost(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** travel cost of a cell from the flow field (Infinity outside) */
export function flowCost(st: Settlement, c: number): number {
  const ff = st.flow;
  if (!ff) return c === st.cell ? 0 : 1e6;
  let lo = 0, hi = ff.cells.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (ff.cells[m] === c) return ff.cost[m];
    if (ff.cells[m] < c) lo = m + 1; else hi = m - 1;
  }
  return Infinity;
}

/** rings a settlement's territory spans */
export function territoryRings(x: PCtx, st: Settlement): number {
  const pop = (x.ps.members.get(st.id)?.length ?? 0) + st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2];
  return Math.min(9, 4 + Math.floor(Math.sqrt(pop) / 2.2));
}

export function pathOptsFor(x: PCtx, species: number): PathOpts {
  const d = x.info[species].def;
  return { swim: d.swim, fly: !!d.fly, maxExpand: 3000 };
}

/** recompute the flow field toward the settlement centre */
export function updateFlow(x: PCtx, st: Settlement): void {
  const ff = buildFlowField(x.p, st.cell, territoryRings(x, st), pathOptsFor(x, st.species));
  st.flow = { tick: x.tick, cells: ff.cells, next: ff.next, cost: ff.cost };
}

/** recompute the resource cache */
export function updateResources(x: PCtx, st: Settlement): void {
  const p = x.p, f = p.f;
  const cells = reachCells(x, st, territoryRings(x, st));
  const sp = x.info[st.species];
  const g = gatherable(x, st);
  const items: Record<string, number[]> = {};
  const scored: [number, number][] = [];
  // routine work stays within a few hours' walk of home (the flow field's travel cost, metre-equivalents): the cells
  // and their costs once, then every item over them
  const ff = st.flow;
  const nearC: number[] = [], nearK: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    const k = ff && cells === ff.cells ? ff.cost[i] : flowCost(st, c);
    if (k <= MAX_WORK_COST) { nearC.push(c); nearK.push(1 / (1 + k / 400)); }
  }
  const I = ids(x);
  for (const [, list] of g) {
    for (const it of list) {
      if (items[String(it)]) continue;
      scored.length = 0;
      const code = I.code[it], ore = I.ore[it];
      for (let i = 0; i < nearC.length; i++) {
        const a = availOf(x, I, code, ore, nearC[i]);
        if (a > 0.06) scored.push([nearC[i], a * nearK[i]]);
      }
      scored.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      const best: number[] = [];
      for (let i = 0; i < scored.length && i < 6; i++) best.push(scored[i][0]);
      items[String(it)] = best;
    }
  }
  const byCost = (l: number[]) => l.sort((a, b) => cmpCost(flowCost(st, a), flowCost(st, b)) || a - b);
  const water: number[] = [];
  const fish: number[] = [];
  const fertile: number[] = [];
  let dune = -1;
  const g2 = p.grid;
  const melt = sp.def.habitat.includes('cold');
  for (const c of nearC) {
    // a drinking spot: fresh water you can stand in, or dry land beside it
    if (f.water[c] < 0.6) {
      let drink = drinkable(p, c) || (melt && snowWater(p, c));
      if (!drink) for (let e = g2.nbrStart[c]; e < g2.nbrStart[c + 1]; e++) if (freshWater(p, g2.nbr[e])) { drink = true; break; }
      if (drink) water.push(c);
    }
    if (f.water[c] > 0.3 && (sp.sea || f.salinity[c] < 0.4)) fish.push(c);
    if (isLand(p, c) && f.water[c] < 0.05 && f.fertility[c] > 0.35 && !st.fields.includes(c) && x.ps.bByCell.get(c).length === 0 && c !== st.cell) fertile.push(c);
    if (dune < 0 && f.sand[c] > 1) dune = c;
  }
  // danger: a predator herd within reach
  let danger = -1;
  const P = p.grid.pos;
  const reach = Math.cos((4 * p.edgeM) / p.st.radius);
  for (const h of x.ps.herds) {
    if (h.count < 0.5 || h.owner >= 0) continue;
    const a = animalDef(x, h.species);
    if (a.danger < 0.3) continue;
    const d = P[h.cell * 3] * st.pos[0] + P[h.cell * 3 + 1] * st.pos[1] + P[h.cell * 3 + 2] * st.pos[2];
    if (d >= reach) { danger = h.id; break; }
  }
  const ctx = new Set<string>();
  const sensed = new Set<number>([st.cell]);
  cellContexts(x, st.cell, st, _ctx);
  for (const k of _ctx) ctx.add(k);
  for (const key of Object.keys(items)) {
    const c = items[key][0];
    if (c === undefined || sensed.has(c)) continue;
    sensed.add(c);
    cellContexts(x, c, st, _ctx);
    for (const k of _ctx) ctx.add(k);
  }
  if (water.length) ctx.add('fresh-water');
  if (fish.length) ctx.add('water');
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.damage >= 0.9 || (b.flags & BuildingFlag.ruined)) continue;
    const prov = x.c.buildings.list[b.type].provides;
    for (const k of prov) if (k !== 'fire') ctx.add(k);
    if (prov.includes('water') && wellFlows(x.p, b.cell) && !water.includes(b.cell)) water.unshift(b.cell);
  }
  for (const k of st.seen ?? []) ctx.add(k);
  const res: ResourceCache = {
    tick: x.tick, items, water: byCost(water).slice(0, 8), fish: byCost(fish).slice(0, 8), fertile: byCost(fertile).slice(0, 10),
    danger, dune, contexts: [...ctx].sort(),
  };
  st.res = res;
}
