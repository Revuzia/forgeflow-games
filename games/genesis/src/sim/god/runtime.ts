// GENESIS — runtime content (CONTRACT.md §11.6): what the god invents in words becomes content. "Introduce chocolate"
// makes an item (with tags guessed from word lists) and the idea of making it; "invent telepathy" makes a knowledge id
// with an effect from the effect vocabulary; "rain frogs" makes a weather kind that rains a new animal. Species laws
// (species.<id>.fertility ...) are content too.
//
// The inventions live in the god state (saved, hashed, rewound) and are compiled into a 'runtime' content pack laid
// over the packs the world was built from. Content is REPLACED, never mutated (u.content is a new object): every cache
// keyed on the content object (species tables, recipe tables) then rebuilds by itself, and the shared base pack JSON is
// never touched. New entries are appended, so every existing index (items, recipes, weather) stays where it was.

import type { Universe } from '../world/universe.ts';
import type { ContentPack, ItemDef, RecipeDef, SpeciesDef, WeatherDef } from '../content.ts';
import { loadContent, RUNTIME_PACK } from '../content.ts';
import { recipeTable } from '../recipes/recipes.ts';

/** the runtime pack for the current god state (null when nothing was invented or overridden) */
export function runtimePack(u: Universe): ContentPack | null {
  const r = u.god.runtime;
  const speciesIds = Object.keys(r.species).sort();
  if (!r.items.length && !r.recipes.length && !r.weather.length && !speciesIds.length) return null;
  const base = u.content;
  const species: SpeciesDef[] = [];
  for (const id of speciesIds) {
    // the original definition (from the packs below the runtime one) with the laws laid over it
    const orig = originalSpecies(u, id);
    if (!orig) continue;
    species.push({ ...JSON.parse(JSON.stringify(orig)) as SpeciesDef, ...JSON.parse(JSON.stringify(r.species[id])) as Partial<SpeciesDef>, id });
  }
  void base;
  return {
    id: RUNTIME_PACK, name: 'Made by the god', version: '1',
    items: r.items.map((x) => ({ ...x })), recipes: r.recipes.map((x) => JSON.parse(JSON.stringify(x)) as RecipeDef),
    weather: r.weather.map((x) => JSON.parse(JSON.stringify(x)) as WeatherDef), species,
  };
}

function originalSpecies(u: Universe, id: string): SpeciesDef | undefined {
  for (let i = u.content.sources.length - 1; i >= 0; i--) {
    const pk = u.content.sources[i];
    if (pk.id === RUNTIME_PACK) continue;
    const hit = (pk.species ?? []).find((s) => s.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Rebuild u.content = base packs (+ mods) + the runtime pack. Called after an invention and when a save / keyframe with
 * inventions is restored. Agents' knowledge bitsets widen if the recipe count crossed a word boundary.
 */
export function rebuildContent(u: Universe): void {
  const packs = u.content.sources.filter((pk) => pk.id !== RUNTIME_PACK);
  const rp = runtimePack(u);
  if (!rp && packs.length === u.content.sources.length) return;
  const c = loadContent(rp ? [...packs, rp] : packs);
  u.content = c;
  const kw = recipeTable(c).kw;
  for (const p of u.planets) {
    if (!p.people) continue;
    p.people.contentRef = c;
    if (p.people.agents.kw < kw) p.people.agents.growKnowledge(kw);
  }
}

/** a slug id from words ("hot chocolate" -> "hot-chocolate") */
export function slug(s: string): string {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'thing';
}

export function titleCase(s: string): string {
  const t = String(s).trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** add (or replace) a runtime item; returns its content index after the rebuild */
export function inventItem(u: Universe, def: ItemDef): number {
  const r = u.god.runtime;
  const i = r.items.findIndex((x) => x.id === def.id);
  if (i >= 0) r.items[i] = def; else r.items.push(def);
  rebuildContent(u);
  return u.content.items.idx(def.id);
}

export function inventRecipe(u: Universe, def: RecipeDef): number {
  const r = u.god.runtime;
  const i = r.recipes.findIndex((x) => x.id === def.id);
  if (i >= 0) r.recipes[i] = def; else r.recipes.push(def);
  rebuildContent(u);
  return u.content.recipes.idx(def.id);
}

export function inventWeather(u: Universe, def: WeatherDef, rainsAnimal?: string): number {
  const r = u.god.runtime;
  const i = r.weather.findIndex((x) => x.id === def.id);
  if (i >= 0) r.weather[i] = def; else r.weather.push(def);
  if (rainsAnimal) r.rains[def.id] = rainsAnimal;
  rebuildContent(u);
  return u.content.weather.idx(def.id);
}

/** set a species law (species.<id>.<key>) */
export function setSpeciesLaw(u: Universe, species: string, key: keyof SpeciesDef, value: unknown): void {
  const r = u.god.runtime;
  const o = (r.species[species] ??= {});
  (o as Record<string, unknown>)[key] = value;
  rebuildContent(u);
}

/** the live value of a species parameter (laws applied) */
export function speciesValue(u: Universe, species: string, key: keyof SpeciesDef): unknown {
  const d = u.content.species.find(species);
  return d ? (d as unknown as Record<string, unknown>)[key] : undefined;
}

/** a weather kind built from a base kind with a new precipitation look (blood, frogs, fish, ink ...) */
export function weatherLike(u: Universe, baseId: string, id: string, name: string, precipType: WeatherDef['precipType'], tint: [number, number, number] | null): WeatherDef {
  const base = u.content.weather.find(baseId) ?? u.content.weather.list[0];
  const w = JSON.parse(JSON.stringify(base)) as WeatherDef;
  w.id = id;
  w.name = name;
  w.precipType = precipType;
  w.spawn = null;
  w.render = { ...(w.render ?? {}), invented: 1, ...(tint ? { skyTint: tint } : {}) };
  return w;
}

/** a new item with guessed properties */
export function itemFrom(id: string, name: string, tags: string[]): ItemDef {
  const food = tags.includes('food') ? (tags.includes('drink') ? 0.3 : 0.6) : undefined;
  const def: ItemDef = {
    id, name: titleCase(name), tags: [...new Set(['artifact', 'invented', ...tags])].sort(), weight: tags.includes('material') ? 2 : 0.5,
    value: tags.includes('luxury') || tags.includes('drug') ? 8 : tags.includes('tool') || tags.includes('weapon') ? 5 : 3,
  };
  if (food !== undefined) def.food = food;
  if (tags.includes('fuel')) def.fuel = 1;
  if (tags.includes('tool') || tags.includes('weapon')) def.quality = 0.6;
  if (tags.includes('food')) def.decay = 0.02;
  return def;
}
