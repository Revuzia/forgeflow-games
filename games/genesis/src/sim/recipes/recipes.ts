// GENESIS — the recipe graph (CONTRACT.md §8.4, §9): recipes.json compiled into dense numeric tables for the agents.
//
// Every recipe is a knowledge id (knowledge index = recipe index). The table resolves inputs and tools by item or tag
// to candidate item indices, prerequisites to bit masks (one test per word), discovery triggers to reverse indices
// (which recipes can an accident teach), gather recipes to "what this task can yield", buildings to the knowledge that
// unlocks them, and passive effects to per-key lists. It is a pure function of the Content (cached per Content object,
// never saved).

import type { Content, RecipeDef } from '../content.ts';
import { ERAS, SKILLS, ENV_CONTEXTS, EVENT_TRIGGERS } from '../content.ts';

export interface RIn {
  /** acceptable item indices (one id, or every item with the tag) */
  items: number[];
  qty: number;
}

export interface CRecipe {
  idx: number;
  id: string;
  name: string;
  kind: RecipeDef['kind'];
  inputs: RIn[];
  /** tool tag -> acceptable item indices */
  tools: number[][];
  needs: string[];
  heat: number;
  near: string[];
  biomes: number[];
  /** prerequisite mask, `kw` words */
  pre: Uint32Array;
  preList: number[];
  outItems: [number, number][];
  outBuildings: number[];
  /** knowledge granted together with this one (alternative paths) */
  grants: number[];
  time: number;
  skill: number;
  difficulty: number;
  base: number;
  curiosity: number;
  triggers: string[];
  teach: number;
  era: number;
  writes: boolean;
  enables: string[];
  effect: Record<string, number>;
  gatherTask: string | null;
  gatherItems: number[];
  /** species indices allowed to learn it (null = all) */
  species: number[] | null;
  secret: number;
  /** a fire-using recipe (needs fuel from the store) */
  hot: boolean;
  /**
   * Where the FIRST try can happen. A recipe whose workplace only those who know it can build (the kiln for kiln
   * firing, the blast furnace for its own craft) is first worked out at the best workplace that does not need it: the
   * building-only contexts nobody else provides are dropped and the heat is capped at what the others reach.
   */
  trial: PlaceSpec;
}

/** what a place must offer: contexts (all), one of `near`, a biome, a heat */
export interface PlaceSpec {
  needs: string[];
  heat: number;
  near: string[];
  biomes: number[];
}

export interface RecipeTable {
  n: number;
  kw: number;
  list: CRecipe[];
  byId: Map<string, number>;
  /** trigger / context -> recipes it can teach by accident or make likelier by experiment */
  byTrigger: Map<string, number[]>;
  /** enabled task / ability -> recipes enabling it */
  byEnable: Map<string, number[]>;
  /** gather task -> recipes listing yields for it */
  byGather: Map<string, number[]>;
  /** item index -> recipes producing it */
  producers: number[][];
  /** building index -> the recipe that unlocks it */
  buildingRecipe: Int32Array;
  /** effect key -> [recipe, multiplier] */
  effects: Map<string, [number, number][]>;
  /** knowledge recipes ordered by era (spawning a people at an era) */
  byEra: number[][];
}

const cache = new WeakMap<Content, RecipeTable>();

export function recipeTable(c: Content): RecipeTable {
  let t = cache.get(c);
  if (!t) {
    t = compile(c);
    cache.set(c, t);
  }
  return t;
}

function itemsFor(c: Content, io: { item?: string; tag?: string }): number[] {
  if (io.item !== undefined) {
    const i = c.items.idx(io.item);
    return i >= 0 ? [i] : [];
  }
  return (c.itemsByTag.get(io.tag ?? '') ?? []).slice();
}

function compile(c: Content): RecipeTable {
  const n = c.recipes.size;
  const kw = Math.max(1, Math.ceil(n / 32));
  const list: CRecipe[] = [];
  const byId = new Map<string, number>();
  c.recipes.list.forEach((r, i) => byId.set(r.id, i));
  const byTrigger = new Map<string, number[]>();
  const byEnable = new Map<string, number[]>();
  const byGather = new Map<string, number[]>();
  const producers: number[][] = c.items.list.map(() => []);
  const buildingRecipe = new Int32Array(c.buildings.size).fill(-1);
  const effects = new Map<string, [number, number][]>();
  const byEra: number[][] = ERAS.map(() => []);
  const push = <K>(m: Map<K, number[]>, k: K, v: number) => {
    let l = m.get(k);
    if (!l) m.set(k, (l = []));
    if (!l.includes(v)) l.push(v);
  };
  c.recipes.list.forEach((r, i) => {
    const pre = new Uint32Array(kw);
    const preList: number[] = [];
    for (const k of r.knowledge ?? []) {
      const j = byId.get(k);
      if (j === undefined) continue;
      pre[j >>> 5] |= 1 << (j & 31);
      preList.push(j);
    }
    const needs = r.place?.needs === undefined ? [] : Array.isArray(r.place.needs) ? r.place.needs.slice() : [r.place.needs];
    const outItems: [number, number][] = [];
    const outBuildings: number[] = [];
    const grants: number[] = [];
    for (const o of r.outputs ?? []) {
      if (o.item) { const it = c.items.idx(o.item); if (it >= 0) { outItems.push([it, o.qty ?? 1]); producers[it].push(i); } }
      if (o.building) { const b = c.buildings.idx(o.building); if (b >= 0) outBuildings.push(b); }
      if (o.knowledge) { const k = byId.get(o.knowledge); if (k !== undefined && k !== i) grants.push(k); }
    }
    const era = Math.max(0, ERAS.indexOf(r.era));
    const cr: CRecipe = {
      idx: i, id: r.id, name: r.name, kind: r.kind,
      inputs: (r.inputs ?? []).map((io) => ({ items: itemsFor(c, io), qty: io.qty })),
      tools: (r.tools ?? []).map((tag) => (c.itemsByTag.get(tag) ?? []).slice()),
      needs, heat: r.place?.heat ?? 0, near: (r.place?.near ?? []).slice(),
      biomes: (r.place?.biome ?? []).map((b) => c.biomes.idx(b)).filter((b) => b >= 0),
      pre, preList, outItems, outBuildings, grants,
      time: Math.max(1, r.time || 60), skill: Math.max(0, SKILLS.indexOf(r.skill)), difficulty: r.difficulty ?? 0.2,
      base: r.discover?.base ?? 0, curiosity: r.discover?.curiosity ?? 0.5, triggers: (r.discover?.triggers ?? []).slice(),
      teach: r.teach ?? 0.3, era, writes: !!r.writes, enables: (r.enables ?? []).slice(), effect: { ...(r.effect ?? {}) },
      gatherTask: r.gather?.task ?? null, gatherItems: (r.gather?.items ?? []).map((x) => c.items.idx(x)).filter((x) => x >= 0),
      species: r.species ? r.species.map((s) => c.species.idx(s)).filter((s) => s >= 0) : null,
      secret: r.secret ?? 0,
      hot: needs.includes('fire') || needs.includes('kiln') || needs.includes('furnace') || needs.includes('forge') || needs.includes('blast-furnace') || (r.place?.heat ?? 0) >= 150,
      trial: { needs, heat: r.place?.heat ?? 0, near: (r.place?.near ?? []).slice(), biomes: [] },
    };
    cr.trial.biomes = cr.biomes;
    list.push(cr);
    for (const tr of cr.triggers) push(byTrigger, tr, i);
    for (const e of cr.enables) push(byEnable, e, i);
    if (cr.gatherTask) push(byGather, cr.gatherTask, i);
    for (const [k, v] of Object.entries(cr.effect)) {
      let l = effects.get(k);
      if (!l) effects.set(k, (l = []));
      l.push([i, v]);
    }
    byEra[era].push(i);
  });
  c.buildings.list.forEach((b, i) => { buildingRecipe[i] = byId.get(b.recipe) ?? -1; });
  // first-try places of self-locked recipes
  const closure = (k: number): Set<number> => {
    const out = new Set<number>();
    const stack = [k];
    while (stack.length) for (const q of list[stack.pop()!].preList) if (!out.has(q)) { out.add(q); stack.push(q); }
    return out;
  };
  const building = (k: number) => k >= 0 ? closure(k) : new Set<number>();
  const deps = c.buildings.list.map((_, bi) => { const k = buildingRecipe[bi]; const s = building(k); if (k >= 0) s.add(k); return s; });
  for (const cr of list) {
    if (!cr.needs.length && cr.heat <= 0) continue;
    // buildings that do not need this recipe, of its age or before (what a people trying it could have standing)
    const free = c.buildings.list.map((b, bi) => (deps[bi].has(cr.idx) || Math.max(0, ERAS.indexOf(b.era as (typeof ERAS)[number])) > cr.era ? null : b))
      .filter((b): b is NonNullable<typeof b> => b !== null);
    const ok = free.some((b) => (b.heat ?? 0) >= cr.heat && cr.needs.every((k) => (b.provides ?? []).includes(k) || !buildingOnly(c, k)));
    if (ok) continue;
    const provided = (k: string) => !buildingOnly(c, k) || free.some((b) => (b.provides ?? []).includes(k));
    const needs = cr.needs.filter(provided);
    let heat = 0;
    for (const b of free) if ((b.heat ?? 0) > heat && needs.every((k) => (b.provides ?? []).includes(k) || !buildingOnly(c, k))) heat = b.heat ?? 0;
    if (cr.heat > 0 && !needs.includes('fire') && heat > 0) needs.push('fire');
    cr.trial = { needs, heat: Math.min(cr.heat, heat), near: cr.near, biomes: cr.biomes };
  }
  return { n, kw, list, byId, byTrigger, byEnable, byGather, producers, buildingRecipe, effects, byEra };
}

/** a context only buildings give (no land, sky or season supplies it) */
function buildingOnly(c: Content, k: string): boolean {
  return !(ENV_CONTEXTS as readonly string[]).includes(k) && !(EVENT_TRIGGERS as readonly string[]).includes(k)
    && c.buildings.list.some((b) => (b.provides ?? []).includes(k));
}

/** do the bits `know` (kw words at offset `off`) include every prerequisite of recipe r */
export function hasPrereqs(r: CRecipe, know: Uint32Array, off: number, kw: number): boolean {
  const pre = r.pre;
  for (let w = 0; w < pre.length; w++) {
    const k = w < kw ? know[off + w] : 0;
    if ((pre[w] & k) !== pre[w]) return false;
  }
  return true;
}

export function bit(know: Uint32Array, off: number, kw: number, k: number): boolean {
  const w = k >>> 5;
  return w < kw && (know[off + w] & (1 << (k & 31))) !== 0;
}

/** product of a passive effect over the known recipes (1 when none applies) */
export function effectOf(t: RecipeTable, key: string, knows: (k: number) => boolean): number {
  const l = t.effects.get(key);
  if (!l) return 1;
  let m = 1;
  for (const [k, v] of l) if (knows(k)) m *= v;
  return m;
}

/** the recipes a people at `era` starts with: everything up to that era its species may learn, prerequisites closed */
export function eraKnowledge(t: RecipeTable, era: number, species: number, start: number[]): number[] {
  const known = new Set<number>(start);
  if (era <= 0) return [...known].sort((a, b) => a - b);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of t.list) {
      if (known.has(r.idx) || r.era > era) continue;
      if (r.species && !r.species.includes(species)) continue;
      if (r.preList.every((k) => known.has(k))) { known.add(r.idx); changed = true; }
    }
  }
  return [...known].sort((a, b) => a - b);
}
