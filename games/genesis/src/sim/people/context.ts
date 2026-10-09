// GENESIS — place contexts (CONTRACT.md §8.4, §9): what a people can sense and use at a place. A recipe names contexts
// it needs (place.needs: 'fire', 'kiln', 'shipyard'...), a heat it must reach and resources it must be near (clay,
// shore, dune...); discovery triggers are contexts too. Contexts come from three sources:
//   * the land around a cell (the cell and its neighbours, i.e. within ~50 m): water, river, shore, forest, ore
//     deposits, dunes, snow, fertile soil, fields, herds and predators nearby, the air (methane);
//   * the settlement's buildings there (each building type `provides` contexts; heat sources only while lit);
//   * fire burning on the land (fire.ts) or lava.
// Heat at a place is the hottest of: fire.ts heatAt over the cells, and lit buildings' heat.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import type { PlaceSpec } from '../recipes/recipes.ts';
import { heatAt as fieldHeat } from '../fields/fire.ts';
import { freshWater } from './world.ts';
import { animalDef } from '../life/herds.ts';

const WILD_GRAIN = new Set(['wild-grain', 'wild-rice', 'teosinte']);
const BERRY = new Set(['berry-bush']);
const REEDS = new Set(['reeds']);

/** plant-id sets resolved to indices once per content */
const plantSets = new WeakMap<object, { grain: Set<number>; berry: Set<number>; reeds: Set<number> }>();
function plantIdx(x: PCtx) {
  let s = plantSets.get(x.c);
  if (!s) {
    const res = (ids: Set<string>) => new Set(x.c.plants.list.map((pl, i) => (ids.has(pl.id) ? i : -1)).filter((i) => i >= 0));
    s = { grain: res(WILD_GRAIN), berry: res(BERRY), reeds: res(REEDS) };
    plantSets.set(x.c, s);
  }
  return s;
}

/** is building b (complete) a live heat source */
export function buildingHeat(x: PCtx, b: { type: number; progress: number; fuel: number; damage: number }, st: Settlement | null): number {
  if (b.progress < 1 || b.damage >= 0.9) return 0;
  const def = x.c.buildings.list[b.type];
  if (def.heat <= 0) return 0;
  if (def.function === 'hearth') return b.fuel > 0 ? def.heat : 0;
  // kilns, furnaces, forges, ovens are fired from the store's fuel when used
  return st && hasFuel(x, st) ? def.heat : b.fuel > 0 ? def.heat : 0;
}

/** fuel items in a settlement store (wood, charcoal, coal, coke...) */
export function hasFuel(x: PCtx, st: Settlement): boolean {
  for (const i of fuelItems(x)) if ((st.store[i] ?? 0) >= 1) return true;
  return false;
}

const fuelCache = new WeakMap<object, number[]>();
export function fuelItems(x: PCtx): number[] {
  let l = fuelCache.get(x.c);
  if (!l) {
    // (propellant — rocket fuel — is kept for the ships, never thrown on a hearth or into a kiln: SIM phase 4)
    l = x.c.items.list.map((it, i) => (it.fuel && it.fuel >= 0.8 && !it.tags.includes('propellant') ? i : -1)).filter((i) => i >= 0);
    // best fuel first
    l.sort((a, b) => (x.c.items.list[b].fuel ?? 0) - (x.c.items.list[a].fuel ?? 0) || a - b);
    fuelCache.set(x.c, l);
  }
  return l;
}

/** contexts of the land at cell c (and its neighbours) + the settlement's buildings there, into `out` */
export function cellContexts(x: PCtx, c: number, st: Settlement | null, out: Set<string>): Set<string> {
  out.clear();
  const p = x.p, f = p.f, g = p.grid;
  const pi = plantIdx(x);
  const ores = x.c.ores.list;
  const atm = p.st.atmosphere;
  if (atm.methane * atm.pressure >= 0.02) out.add('methane');
  const t = f.temperature[c];
  if (t < 0) out.add('cold');
  if (t > 30) out.add('hot');
  const visit = (o: number, self: boolean) => {
    const w = f.water[o];
    if (w > 0.05) {
      out.add('water');
      if (freshWater(p, o)) out.add('fresh-water');
      if (p.s.ocean[o] || f.salinity[o] > 0.5) out.add('sea');
      const fl = Math.abs(f.flowX[o]) + Math.abs(f.flowY[o]) + Math.abs(f.flowZ[o]);
      if (fl > 0.004 && !p.s.ocean[o]) out.add('river');
      if (!self || w < 0.3) out.add('shore');
    }
    if (f.tree[o] > 0.1) out.add('wood');
    if (self && f.tree[o] > 0.35) out.add('forest');
    if (f.grass[o] > 0.2) out.add('grass');
    const gs = f.grassSpecies[o];
    if (gs >= 0 && f.grass[o] > 0.08 && pi.grain.has(gs)) out.add('wild-grain');
    if (gs >= 0 && f.grass[o] > 0.08 && pi.reeds.has(gs)) out.add('reeds');
    const ss = f.shrubSpecies[o];
    if (ss >= 0 && f.shrub[o] > 0.06 && pi.berry.has(ss)) out.add('berries');
    if (f.crop[o] > 0.02) out.add('field');
    if (self && f.fertility[o] > 0.45) out.add('fertile');
    if (f.sand[o] > 1.0) out.add('dune');
    if (f.sand[o] > 0.2) out.add('sand');
    if (f.snow[o] > 0.1) out.add('snow');
    if (f.ice[o] > 0.2 || p.s.seaIce[o] > 0.05) out.add('ice');
    if (f.lava[o] > 0.01 || f.ash[o] > 0.1) out.add('volcanic');
    if (f.surface[o] - p.st.seaLevel > 150) out.add('mountain');
    if (f.fire[o] > 0.05 || f.lava[o] > 0.01) out.add('fire');
    const ot = f.oreType[o];
    if (ot > 0 && f.ore[o] > 0.1) {
      const id = ores[ot - 1]?.id;
      if (id) out.add(id === 'glass-sand' ? 'glass-sand' : id);
      if (id === 'glass-sand') out.add('sand');
    }
    // river banks carry clay even without a mapped deposit
    if (f.soil[o] > 0.3 && Math.abs(f.flowX[o]) + Math.abs(f.flowY[o]) + Math.abs(f.flowZ[o]) > 0.004 && f.water[o] > 0.02) out.add('clay');
  };
  visit(c, true);
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) visit(g.nbr[e], false);
  // rock showing through: stone
  if (f.soil[c] < 0.25 || out.has('mountain')) out.add('stone');
  // herds and predators within ~2 cells
  const P = g.pos;
  const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
  const reach = Math.cos((2.5 * p.edgeM) / p.st.radius);
  for (const h of x.ps.herds) {
    if (h.count < 0.5) continue;
    const hc = h.cell;
    const d = P[hc * 3] * cx + P[hc * 3 + 1] * cy + P[hc * 3 + 2] * cz;
    if (d < reach) continue;
    const a = animalDef(x, h.species);
    if (a.kind === 'predator') out.add('predators');
    if (a.kind === 'fish') out.add('fish');
    else if (a.kind !== 'insect') out.add('herds');
    if (a.kind === 'domestic' || h.owner >= 0) out.add('pen');
  }
  // the settlement's buildings at and around the cell
  if (st) {
    const addB = (cell: number) => {
      const ids = x.ps.bByCell.get(cell);
      for (let i = 0; i < ids.length; i++) {
        const b = x.ps.building(ids[i]);
        if (!b || b.progress < 1 || b.damage >= 0.9) continue;
        const def = x.c.buildings.list[b.type];
        const heat = def.heat > 0 ? buildingHeat(x, b, st) : 0;
        for (const k of def.provides) {
          if (k === 'fire' && heat <= 0) continue;
          out.add(k);
        }
      }
    };
    addB(c);
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) addB(g.nbr[e]);
    let stored = 0;
    for (let i = 0; i < st.store.length; i++) stored += st.store[i];
    if (stored > 4) out.add('store');
  }
  return out;
}

/** the hottest heat source within reach of cell c (°C) */
export function heatNear(x: PCtx, c: number, st: Settlement | null): number {
  const p = x.p, g = p.grid;
  let h = fieldHeat(p, c);
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) h = Math.max(h, fieldHeat(p, g.nbr[e]));
  const scan = (cell: number) => {
    const ids = x.ps.bByCell.get(cell);
    for (let i = 0; i < ids.length; i++) {
      const b = x.ps.building(ids[i]);
      if (b && (!st || b.settlement === st.id)) h = Math.max(h, buildingHeat(x, b, st));
    }
  };
  scan(c);
  for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) scan(g.nbr[e]);
  return h;
}

/** can recipe r be worked at cell c (contexts `ctx` already sensed there) */
export function placeOk(x: PCtx, r: PlaceSpec, c: number, st: Settlement | null, ctx: Set<string>): boolean {
  for (const k of r.needs) if (!ctx.has(k)) return false;
  if (r.near.length) {
    let any = false;
    for (const k of r.near) if (ctx.has(k)) { any = true; break; }
    if (!any) return false;
  }
  if (r.biomes.length && !r.biomes.includes(x.p.f.biome[c])) return false;
  if (r.heat > 0 && heatNear(x, c, st) < r.heat) return false;
  return true;
}

const _ctx = new Set<string>();

/**
 * findPlaceFor through the settlement's hourly place cache (saved with the settlement, so it is part of the state and a
 * loaded game answers exactly as the running one did).
 */
export function placeFor(x: PCtx, r: PlaceSpec, st: Settlement, key: string): { cell: number; building: number } | null {
  const hour = Math.floor(x.tick / 60);
  let pc = st.places;
  if (!pc || pc.hour !== hour) st.places = pc = { hour, at: {} };
  const hit = pc.at[key];
  if (hit) return hit.length ? { cell: hit[0], building: hit[1] } : null;
  const place = findPlaceFor(x, r, st);
  pc.at[key] = place ? [place.cell, place.building] : [];
  return place;
}

/**
 * Where in its territory a settlement can work recipe r: a building providing what it needs, the centre, or a cell
 * with the resources it must be near. Returns the cell (and the building id used, -1 none) or null.
 */
export function findPlaceFor(x: PCtx, r: PlaceSpec, st: Settlement): { cell: number; building: number } | null {
  const tried = new Set<number>();
  const tryCell = (c: number, b: number) => {
    if (c < 0 || tried.has(c)) return null;
    tried.add(c);
    cellContexts(x, c, st, _ctx);
    return placeOk(x, r, c, st, _ctx) ? { cell: c, building: b } : null;
  };
  if (r.needs.length || r.heat > 0) {
    for (const b of x.ps.of(st.id)) {
      if (b.progress < 1) continue;
      const def = x.c.buildings.list[b.type];
      let match = r.needs.length === 0;
      for (const k of r.needs) if (def.provides.includes(k)) { match = true; break; }
      if (r.heat > 0 && def.heat >= r.heat) match = true;
      if (!match) continue;
      const hit = tryCell(b.cell, b.id);
      if (hit) return hit;
    }
  }
  const hit = tryCell(st.cell, -1);
  if (hit) return hit;
  if (st.res) {
    for (const c of st.res.water.slice(0, 3)) { const h2 = tryCell(c, -1); if (h2) return h2; }
    for (const c of st.res.fish.slice(0, 3)) { const h2 = tryCell(c, -1); if (h2) return h2; }
    for (const key of Object.keys(st.res.items)) {
      for (const c of st.res.items[key].slice(0, 2)) { const h2 = tryCell(c, -1); if (h2) return h2; }
      if (tried.size > 24) break;
    }
  }
  return null;
}
