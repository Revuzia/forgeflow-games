// GENESIS — placing peoples on a world (CONTRACT.md §6.5 scenarios, §11.1 life.spawn-people): a stone-age band set
// down to find its own way, or an established people at an era (scenarios' "bronze", "iron", "classical"...) with its
// knowledge spread over its members (everyday skills by everyone, crafts by some, at least two masters of each), its
// houses, workplaces, fields, stores and written books already standing.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Settlement } from './state.ts';
import { ERAS } from '../content.ts';
import { AgentFlag } from '../types.ts';
import { hashFloat } from '../core/rng.ts';
import { makeCtx, type PCtx } from './ctx.ts';
import { eraKnowledge } from '../recipes/recipes.ts';
import { createBand, found, reachable, searchSite, siteScore, assignRoles, chooseCrop, seasonTemps } from './settlement.ts';
import { planBuilding, canBuild } from './buildings.ts';
import { learn, refreshLibrary } from './knowledge.ts';
import { storeAdd } from './store.ts';
import { updateResources, itemIdx } from './resources.ts';
import { cellPos, isLand } from './world.ts';
import { NS } from './defs.ts';

export interface SpawnSpec {
  species: string;
  count: number;
  /** a unit vector or a cell */
  pos?: ArrayLike<number>;
  cell?: number;
  era?: string;
  /** settle at once (eras above stone always do) */
  settled?: boolean;
  /** size hint for established settlements: 'village' | 'town' | 'city' */
  size?: string;
  /** stay a band whatever the era (newcomers who will join a settlement: god/civic, people/commands joinSettlement) */
  band?: boolean;
}

/** a good land cell for a species near `from` (or anywhere on the planet) */
export function landingCell(x: PCtx, species: number, from: number, rings = 5): number {
  const best = searchSite(x, species, from, rings);
  if (best.cell >= 0 && best.score > 0) return best.cell;
  if (isLand(x.p, from)) return from;
  // nearest land
  const g = x.p.grid;
  const seen = new Set<number>([from]);
  let fr = [from];
  for (let d = 0; d < 30; d++) {
    const nf: number[] = [];
    for (const c of fr) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    nf.sort((a, b) => a - b);
    for (const o of nf) if (isLand(x.p, o) && x.p.f.water[o] < 0.1) return o;
    fr = nf;
  }
  return from;
}

/** the best site on the whole planet for a species (scenario placement) */
export function bestSiteOnPlanet(x: PCtx, species: number, salt: number): number {
  let best = -1, bs = -Infinity;
  const step = Math.max(1, Math.floor(x.p.count / 2500));
  const off = salt % step;
  for (let c = off; c < x.p.count; c += step) {
    const v = siteScore(x, species, c) + hashFloat(c, salt, 0x5173) * 0.6;
    if (v > bs) { bs = v; best = c; }
  }
  return best;
}

/** spawn a people; returns its settlement */
export function spawnPeople(u: Universe, p: Planet, spec: SpawnSpec): Settlement | null {
  const x = makeCtx(u, p);
  const sp = x.c.species.idx(spec.species);
  if (sp < 0) return null;
  const at = spec.cell ?? (spec.pos ? p.cellAt(spec.pos) : bestSiteOnPlanet(x, sp, p.people.settlements.length + 1));
  if (at < 0) return null;
  const era = Math.max(0, ERAS.indexOf((spec.era ?? 'stone') as (typeof ERAS)[number]));
  const settle = !spec.band && (era > 0 || !!spec.settled);
  // where they will live: the best site near the drop
  const site = landingCell(x, sp, at);
  // an established people stands on its site at once; a band set down by the hand stands where it was put (on the
  // nearest dry land) and walks to the place it chose — it used to appear ~165 m from the hand
  const stand = settle ? site : nearestDryLand(x, at);
  const all = eraKnowledge(x.rt, era, sp, x.info[sp].start);
  const st = createBand(x, sp, stand, Math.max(1, Math.round(spec.count)), { era, skill: 0.3 + era * 0.04 });
  distributeKnowledge(x, st, all);
  refreshLibrary(x, st);
  if (settle) establish(x, st, site, era, spec.size ?? (spec.count > 100 ? 'city' : spec.count > 50 ? 'town' : 'village'));
  // the band heads for its site when it can walk there; otherwise it looks about for itself (settlement.ts bandStep)
  else if (site !== stand && reachable(x, st, stand, site)) st.target = cellPos(p, site) as [number, number, number];
  return st;
}

/** the cell itself when it is dry land, else the nearest dry land cell (breadth-first, deterministic) */
function nearestDryLand(x: PCtx, from: number): number {
  const dry = (c: number) => isLand(x.p, c) && x.p.f.water[c] < 0.15 && x.p.f.lava[c] <= 0;
  if (dry(from)) return from;
  const g = x.p.grid;
  const seen = new Set<number>([from]);
  let fr = [from];
  for (let d = 0; d < 30; d++) {
    const nf: number[] = [];
    for (const c of fr) for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { const o = g.nbr[e]; if (!seen.has(o)) { seen.add(o); nf.push(o); } }
    nf.sort((a, b) => a - b);
    for (const o of nf) if (dry(o)) return o;
    fr = nf;
  }
  return from;
}

/** everyday knowledge for everyone, crafts for some, at least two knowers (masters) of each */
function distributeKnowledge(x: PCtx, st: Settlement, all: number[]): void {
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  const adults = members.filter((m) => !(A.flags[m] & AgentFlag.child));
  for (const k of all) {
    const r = x.rt.list[k];
    const share = r.teach <= 0.2 ? 1 : r.teach <= 0.35 ? 0.6 : 0.3;
    let knowers = 0;
    for (const m of adults) {
      if (share >= 1 || hashFloat(A.id[m], k, 0xd157) < share) {
        A.setKnows(m, k, true);
        for (const g of r.grants) A.setKnows(m, g, true);
        knowers++;
      }
    }
    // at least two, and they are good at it
    for (let i = 0; knowers < Math.min(2, adults.length) && i < adults.length; i++) {
      const m = adults[(i + k) % adults.length];
      if (!A.knows(m, k)) { A.setKnows(m, k, true); knowers++; }
    }
    let masters = 0;
    for (const m of adults) {
      if (!A.knows(m, k) || masters >= 2) continue;
      A.skills[m * NS + r.skill] = Math.max(A.skills[m * NS + r.skill], 0.72 + 0.2 * hashFloat(A.id[m], k, 0x3a5));
      masters++;
    }
  }
  // children know the everyday things already
  for (const m of members) {
    if (!(A.flags[m] & AgentFlag.child)) continue;
    for (const k of all) if (x.rt.list[k].teach <= 0.15) A.setKnows(m, k, true);
  }
  // a cohort (members beyond the cap) knows as its individual adults do
  if (st.cohort.n[1] + st.cohort.n[2] > 0) {
    for (const k of all) {
      const r = x.rt.list[k];
      const share = r.teach <= 0.2 ? 1 : r.teach <= 0.35 ? 0.6 : 0.3;
      st.cohort.know[String(k)] = share;
    }
    st.cohort.skill = Math.max(st.cohort.skill, 0.3);
  }
  void learn;
}

const SHELTERS = ['house', 'longhouse', 'hive-mound', 'igloo', 'hut'];
const WORKPLACES = ['hearth', 'granary', 'store-pit', 'kiln', 'furnace', 'forge', 'oven', 'workshop', 'pen', 'well', 'shrine', 'temple', 'library',
  'school', 'market', 'dock', 'mill', 'observatory', 'mine', 'wall', 'tower', 'shipyard', 'lighthouse', 'aqueduct', 'factory', 'lab', 'powerplant',
  'refinery', 'radio-mast', 'blast-furnace', 'launchpad'];

/** settle at once with what an established people of this era has standing */
function establish(x: PCtx, st: Settlement, cell: number, era: number, size: string): void {
  found(x, st, cell, null);
  const members = x.ps.members.get(st.id) ?? [];
  const pop = members.length;
  // the cohort eats from the store too
  const all = pop + st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2];
  // stores: food for a season, materials for building
  const add = (id: string, q: number) => { const it = itemIdx(x, id); if (it >= 0) storeAdd(x, st, it, q); };
  const sp = x.info[st.species];
  const food = sp.foods.find((i) => (x.c.items.list[i].decay ?? 0) < 0.02) ?? sp.foods[0];
  if (food !== undefined) storeAdd(x, st, food, all * 6 / Math.max(0.1, sp.edible[food]));
  add('wood', 20 + pop); add('stone', 12); add('reeds', 12); add('clay', 8); add('fiber', 8); add('hide', 4);
  if (era >= 2) { add('mudbrick', 30); add('pot', 6); add('grain', pop * 2); }
  if (era >= 3) { add('timber', 30); add('stone-block', 20); add('brick', 30); add('copper', 4); add('tin', 2); add('bronze', 4); add('charcoal', 10); add('bronze-tools', 6); add('cloth', 6); }
  if (era >= 4) { add('iron', 6); add('iron-tools', 6); }
  if (era >= 5) { add('glass', 4); add('concrete', 20); add('paper', 10); add('ink', 2); }
  // homes for everyone
  const beds = () => x.ps.of(st.id).filter((b) => true).reduce((a, b) => a + x.c.buildings.list[b.type].capacity, 0);
  for (const id of SHELTERS) {
    const t = x.c.buildings.idx(id);
    if (t < 0 || !canBuild(x, st, t)) continue;
    if (id === 'igloo' && x.p.f.temperature[st.cell] > -2) continue;
    if (id === 'longhouse' && size === 'village') continue;
    let guard = 0;
    while (beds() < pop + 2 && guard++ < 60) if (!planBuilding(x, st, t, true)) break;
    if (beds() >= pop + 2) break;
  }
  // workplaces they know
  const big = size === 'city' ? 2 : size === 'town' ? 1 : 0;
  for (const id of WORKPLACES) {
    const t = x.c.buildings.idx(id);
    if (t < 0 || !canBuild(x, st, t)) continue;
    const def = x.c.buildings.list[t];
    if (def.cost >= 20 && big === 0) continue;
    if ((id === 'dock' || id === 'shipyard' || id === 'lighthouse') && !(st.res && st.res.fish.length)) continue;
    if (id === 'store-pit' && canBuild(x, st, x.c.buildings.idx('granary'))) continue;
    const n = id === 'wall' ? 6 + big * 4 : id === 'granary' || id === 'workshop' ? 1 + big : 1;
    for (let i = 0; i < n; i++) planBuilding(x, st, t, true);
  }
  // fields of the domestic crop
  const ag = x.rt.byId.get('agriculture');
  if (ag !== undefined && st.library.includes(ag)) {
    st.crop = chooseCrop(x, st);
    updateResources(x, st);
    const f = x.p.f;
    for (const c of (st.res?.fertile ?? []).slice(0, Math.min(10, 2 + Math.floor(pop / 5)))) {
      f.cropSpecies[c] = st.crop;
      f.crop[c] = 0.25 + 0.4 * hashFloat(c, st.id, 0xf1e1);
      f.tree[c] = 0; f.shrub[c] = 0; f.grass[c] *= 0.3;
      st.fields.push(c);
    }
    st.fields.sort((a, b) => a - b);
    x.p.bump('crop'); x.p.bump('cropSpecies');
    x.p.vegDirty = true;
  }
  // books in the library
  const lib = x.ps.of(st.id).find((b) => x.c.buildings.list[b.type].function === 'library');
  if (lib) {
    for (const k of st.library) if (x.rt.list[k].teach >= 0.35 && lib.books.length < 24) lib.books.push(k);
    lib.books.sort((a, b) => a - b);
  }
  refreshLibrary(x, st);
  updateResources(x, st);
  assignRoles(x, st);
  // everyone has a home
  for (const hh of st.households) hh.home = -1;
  // a people of the bronze age and after goes clothed: woven in the later ages, hides before; furs where the winter
  // bites (a city of the electric age began naked at 53° south and froze in its houses in its third winter)
  // (bodies that wear clothes: the two-legged peoples; a hive's castes and the drifters go as they are)
  if (era >= 3 && x.info[st.species].def.body === 'biped') {
    const [, lo] = x.info[st.species].def.temp;
    const winter = seasonTemps(x, cell).winter;
    const wear = itemIdx(x, winter < lo - 4 ? 'fur-clothes' : era >= 5 ? 'cloth-clothes' : 'hide-clothes');
    if (wear >= 0) {
      const A = x.A;
      for (const m of members) if (A.gear[m] < 0) A.gear[m] = wear;
      // and some to spare for the children who grow into them
      storeAdd(x, st, wear, Math.ceil(pop * 0.15));
    }
  }
}
