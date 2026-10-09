// GENESIS — the working context handed through the peoples systems (universe, planet, people state, content tables,
// tick, calendar lengths) and per-species numeric tables compiled from species/*.json (need weights and decay rates,
// what each item is worth as food to this species, start knowledge, taboos, colours). Tables are pure functions of
// the Content and cached per Content object.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Content, SpeciesDef } from '../content.ts';
import { NEEDS } from '../content.ts';
import type { AgentStore } from './agents.ts';
import type { PeopleState } from './state.ts';
import { recipeTable, type RecipeTable } from '../recipes/recipes.ts';
import { dayTicks, NN } from './defs.ts';

export interface SpeciesInfo {
  idx: number;
  def: SpeciesDef;
  needW: Float32Array;
  decay: Float32Array;
  /** days of food per unit for this species (0 = inedible) */
  edible: Float32Array;
  /** edible item indices, best first */
  foods: number[];
  start: number[];
  taboos: number[];
  styleMats: number[];
  skin: number[];
  hair: number[];
  cloth: number[];
  caste: number[];
  /** forage sources */
  vegetation: boolean;
  sea: boolean;
  air: boolean;
  aquatic: boolean;
  cold: boolean;
}

export interface PCtx {
  u: Universe;
  p: Planet;
  ps: PeopleState;
  A: AgentStore;
  c: Content;
  rt: RecipeTable;
  tick: number;
  /** ticks per day / per year on this planet */
  day: number;
  year: number;
  info: SpeciesInfo[];
}

/** base decay per day of each need (scaled by the species decay table); env-driven needs are 0 here */
const BASE_DECAY: Record<string, number> = {
  food: 0.55, water: 0.95, warmth: 0, rest: 0.75, safety: 0, belonging: 0.22, status: 0.08, curiosity: 0.3, faith: 0.12,
  wetness: 0.7, methane: 0, hive: 0,
};

const infoCache = new WeakMap<Content, SpeciesInfo[]>();

export function packColor(hex: string): number {
  return parseInt(hex.slice(1), 16) >>> 0;
}

export function speciesInfo(c: Content): SpeciesInfo[] {
  let l = infoCache.get(c);
  if (l) return l;
  const rt = recipeTable(c);
  l = c.species.list.map((def, idx) => {
    const needW = new Float32Array(NN);
    const decay = new Float32Array(NN);
    NEEDS.forEach((n, i) => {
      needW[i] = def.needs[n] ?? 0;
      decay[i] = (BASE_DECAY[n] ?? 0) * (def.decay?.[n] ?? 1);
    });
    const edible = new Float32Array(c.items.size);
    c.items.list.forEach((it, i) => {
      if (!it.food || !it.tags.includes('food')) return;
      let best = 0;
      for (const t of it.tags) { const w = def.diet[t]; if (w !== undefined && w > best) best = w; }
      if (best <= 0) return;
      const cooked = it.tags.includes('cooked') && def.diet.cooked ? def.diet.cooked : 1;
      edible[i] = it.food * Math.min(1.6, best) * cooked;
    });
    const foods = [...edible.keys()].filter((i) => edible[i] > 0).sort((a, b) => edible[b] - edible[a] || a - b);
    const info: SpeciesInfo = {
      idx, def, needW, decay, edible, foods,
      start: (def.start ?? []).map((k) => rt.byId.get(k) ?? -1).filter((k) => k >= 0),
      taboos: (def.taboos ?? []).map((k) => rt.byId.get(k) ?? -1).filter((k) => k >= 0),
      styleMats: (def.style?.materials ?? []).map((m) => c.materials.idx(m)).filter((m) => m >= 0),
      skin: (def.colors.skin ?? []).map(packColor),
      hair: (def.colors.hair ?? []).map(packColor),
      cloth: (def.colors.cloth ?? []).map(packColor),
      caste: def.hive ? def.hive.castes.map((k) => packColor(def.colors.caste?.[k] ?? def.colors.skin[0])) : [],
      vegetation: def.forage.includes('vegetation'),
      sea: def.forage.includes('sea'),
      air: def.forage.includes('air'),
      aquatic: def.habitat.includes('water') || def.habitat.includes('coast'),
      cold: def.habitat.includes('cold'),
    };
    return info;
  });
  infoCache.set(c, l);
  return l;
}

export function makeCtx(u: Universe, p: Planet): PCtx {
  const c = u.content;
  const day = dayTicks(p.st.dayHours);
  // hooks without a universe (witness) read the people's clock
  if (p.people) p.people.now = u.tick;
  return {
    u, p, ps: p.people, A: p.people.agents, c, rt: recipeTable(c), tick: u.tick, day,
    year: Math.max(day, Math.round(p.st.orbit.period)), info: speciesInfo(c),
  };
}

/** age in planet years */
export function ageYears(x: PCtx, s: number): number {
  return (x.tick - x.A.birth[s]) / x.year;
}
