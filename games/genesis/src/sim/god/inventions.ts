// GENESIS — inventions (CONTRACT.md §11.6): commands that make NEW CONTENT at runtime, so words the world never knew
// still become things. The freeform parser resolves unknown nouns to these; they are also powers of their own.
//
//   content.item     a new item (tags guessed from word lists: food, drink, material, tool, weapon, drug, cloth,
//                    luxury, fuel ...) and the craft that makes it (from what its tags suggest) — introduced near a
//                    settlement it is an artifact they can puzzle out (reverse engineering teaches the craft)
//   content.idea     a new idea (knowledge) with an effect from the effect vocabulary (faster teaching, belief, trade,
//                    harvests, healing, war ...): taught to a settlement it works through the same library effects
//                    every built-in idea uses
//   content.weather  a new weather kind from a base kind with a new rain (blood, frogs, fish, ink, honey ...); if it
//                    rains an animal, that animal becomes a species of the world and herds of it land under the storm
//   content.animal   a new animal species on this world (body from the nearest known kind) and a herd of it

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { AnimalDef, RecipeDef } from '../content.ts';
import type { V3 } from './state.ts';
import { PRECIP_TYPES } from '../content.ts';
import { makeCtx } from '../people/ctx.ts';
import { animalIdx, habitatFit, spawnHerd } from '../life/herds.ts';
import { plural } from '../life/ecology.ts';
import { paintWeather } from '../fields/weather.ts';
import { inventItem, inventRecipe, inventWeather, itemFrom, slug, titleCase, weatherLike } from './runtime.ts';
import { fail, herePos, norm, ok } from './util.ts';

/** what a new item is made from, by its tags (inputs every early people can gather) */
function inputsFor(tags: string[]): { item: string; qty: number }[] {
  if (tags.includes('drink')) return [{ item: 'berries', qty: 2 }, { item: 'honey', qty: 1 }];
  if (tags.includes('food')) return [{ item: 'berries', qty: 2 }, { item: 'nuts', qty: 1 }];
  if (tags.includes('drug')) return [{ item: 'herbs', qty: 2 }];
  if (tags.includes('cloth')) return [{ item: 'fiber', qty: 3 }];
  if (tags.includes('weapon') || tags.includes('tool')) return [{ item: 'stick', qty: 1 }, { item: 'flint', qty: 1 }];
  if (tags.includes('fuel')) return [{ item: 'wood', qty: 2 }];
  if (tags.includes('luxury')) return [{ item: 'clay', qty: 1 }, { item: 'resin', qty: 1 }];
  return [{ item: 'stone', qty: 1 }, { item: 'clay', qty: 1 }];
}

export function makeItem(u: Universe, name: string, tags: string[]): { item: string; recipe: string } {
  const id = u.content.items.has(name) ? name : slug(name);
  if (!u.content.items.has(id)) inventItem(u, itemFrom(id, name, tags));
  const rid = `${id}-making`;
  if (!u.content.recipes.has(rid)) {
    const r: RecipeDef = {
      id: rid, name: `${titleCase(name)} making`, kind: 'craft', inputs: inputsFor(tags), tools: [], place: {}, knowledge: [],
      outputs: [{ item: id, qty: 1 }], time: 90, skill: tags.includes('food') || tags.includes('drink') ? 'cook' : 'craft', difficulty: 0.35,
      discover: { base: 0, triggers: [], curiosity: 0 }, teach: 0.3, era: 'stone', desc: `How to make ${name} (an invention of the god).`,
    };
    inventRecipe(u, r);
  }
  return { item: id, recipe: rid };
}

export function makeIdea(u: Universe, name: string, effect: string, mult: number): string {
  const id = u.content.recipes.has(name) ? name : slug(name);
  if (u.content.recipes.has(id)) return id;
  const r: RecipeDef = {
    id, name: titleCase(name), kind: 'idea', inputs: [], tools: [], place: {}, knowledge: [], outputs: [], time: 0, skill: 'lore', difficulty: 0.3,
    discover: { base: 0, triggers: [], curiosity: 0 }, teach: 0.35, era: 'stone', desc: `An idea the god put into the world: ${name}.`,
    effect: { [effect]: mult },
  };
  inventRecipe(u, r);
  return id;
}

/** a new animal species of this world (derived from the closest known body) */
export function makeAnimal(u: Universe, p: Planet, name: string, like?: string): number {
  const x = makeCtx(u, p);
  const id = slug(name);
  const have = animalIdx(x, id);
  if (have >= 0) return have;
  const baseId = like && u.content.animals.has(like) ? like : guessBase(name);
  const base = Math.max(0, u.content.animals.idx(baseId));
  const parent = u.content.animals.list[base];
  const def: AnimalDef = {
    ...parent, id, name: titleCase(name), domestic: false, domesticable: false,
    biomes: u.content.biomes.ids(), temp: [parent.temp[0] - 10, parent.temp[1] - 8, parent.temp[2] + 8, parent.temp[3] + 10],
  };
  const idx = x.c.animals.size + x.ps.species.length;
  x.ps.species.push({ idx, def, base, parent: base, born: u.tick });
  x.ps.eco.seen[String(idx)] = u.tick;
  x.ps.version++;
  return idx;
}

/** the body a new animal borrows (by what its name sounds like) */
function guessBase(name: string): string {
  const n = name.toLowerCase();
  const table: [RegExp, string][] = [
    [/frog|toad|newt|lizard|snake|serpent|salamander|turtle|croc/, 'desert-lizard'], [/fish|eel|carp|trout|cod|salmon|shark/, 'fish-shoal'],
    [/bird|crow|raven|dove|hawk|eagle|owl|bat|dragon/, 'vulture'], [/bug|insect|beetle|locust|ant|bee|wasp|moth|butterfl|spider/, 'locust-swarm'],
    [/whale|leviathan|kraken|squid|octop/, 'whale'], [/cat|lion|tiger|leopard|panther/, 'wolf'], [/dog|wolf|hound|fox|jackal|hyena/, 'wolf'],
    [/bear|ape|monkey|gorilla/, 'bear'], [/horse|unicorn|zebra|donkey|camel/, 'wild-horse'], [/cow|ox|bull|buffalo|bison|yak/, 'aurochs'],
    [/pig|hog|boar/, 'boar'], [/goat|sheep|ram|llama/, 'wild-goat'], [/rabbit|hare|mouse|rat|squirrel|mole/, 'rabbit'], [/deer|elk|moose|antelope|gazelle/, 'deer'],
  ];
  for (const [re, id] of table) if (re.test(n)) return id;
  return 'rabbit';
}

/** a herd of a species dropped near pos where it can live */
export function dropHerd(u: Universe, p: Planet, sp: number, pos: V3, count: number): number {
  const x = makeCtx(u, p);
  let c = p.cellAt(pos);
  if (habitatFit(x, sp, c) <= 0) for (const o of p.cellsNear(pos, 600)) if (habitatFit(x, sp, o) > 0) { c = o; break; }
  if (habitatFit(x, sp, c) <= 0) return 0;
  const h = spawnHerd(x, sp, c, count);
  return h ? h.id : 0;
}

const iPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

export function registerInventionCommands(r: CommandRegistry): void {
  r.register('content.item', ({ u }, a) => {
    const name = String(a.name).trim().slice(0, 40);
    if (!name) return fail('Name the thing.');
    const tags = Array.isArray(a.tags) ? (a.tags as unknown[]).map(String) : ['material'];
    const had = u.content.items.has(slug(name)) || u.content.items.has(name);
    const m = makeItem(u, name, tags);
    return ok(had ? `${titleCase(name)} already exists.` : `${titleCase(name)} now exists (${tags.join(', ')}), and so does the craft of making it.`, [{ kind: 'item', id: u.content.items.idx(m.item) }]);
  }, { desc: 'Invent a new thing', category: 'Ideas', params: { name: { type: 'string', required: true }, tags: { type: 'any', desc: 'food, drink, material, tool, weapon, drug, cloth, luxury, fuel ...' } } });
  r.register('content.idea', ({ u }, a) => {
    const name = String(a.name).trim().slice(0, 40);
    if (!name) return fail('Name the idea.');
    const had = u.content.recipes.has(slug(name)) || u.content.recipes.has(name);
    const id = makeIdea(u, name, String(a.effect ?? 'teach'), Number(a.mult ?? 1.4));
    return ok(had ? `The idea of ${name} already exists.` : `The idea of ${name} now exists (${a.effect ?? 'teach'} ×${a.mult ?? 1.4}). Teach it to someone.`, [{ kind: 'item', id: u.content.recipes.idx(id) }]);
  }, {
    desc: 'Invent a new idea', category: 'Ideas',
    params: { name: { type: 'string', required: true }, effect: { type: 'enum', values: ['teach', 'faith', 'trade', 'yield.farm', 'yield.forage', 'yield.hunt', 'yield.fish', 'mortality', 'contagion', 'speed', 'war', 'diplomacy', 'safety', 'order', 'light', 'haul', 'road', 'blight'], default: 'teach' }, mult: { type: 'number', min: 0.1, max: 5, default: 1.4 } },
  });
  r.register('content.weather', ({ u, p }, a) => {
    const name = String(a.name).trim().slice(0, 40);
    if (!name) return fail('Name the weather.');
    const id = slug(name);
    const precip = PRECIP_TYPES.includes(a.precip as (typeof PRECIP_TYPES)[number]) ? a.precip as (typeof PRECIP_TYPES)[number] : 'rain';
    let animal: string | undefined;
    if (typeof a.animal === 'string' && a.animal) {
      const sp = makeAnimal(u, p, a.animal, typeof a.like === 'string' ? a.like : undefined);
      animal = makeCtx(u, p).ps.species.find((d) => d.idx === sp)?.def.id ?? (sp < u.content.animals.size ? u.content.animals.list[sp].id : undefined);
    }
    if (!u.content.weather.has(id)) inventWeather(u, weatherLike(u, String(a.base ?? 'rain'), id, titleCase(name), precip, Array.isArray(a.tint) ? a.tint as [number, number, number] : null), animal);
    let created;
    if (a.paint !== false) {
      const w = paintWeather(u, p, id, norm(a.pos ?? herePos(u, p)), Number(a.radius ?? 600), Number(a.duration ?? 720), Number(a.intensity ?? 1), false);
      if (w) created = [{ kind: 'weather' as const, id: w.id, planet: p.id }];
    }
    return ok(`${titleCase(name)} ${a.paint !== false ? 'begins to fall' : 'is now a weather of the world'}${animal ? `: ${plural(String(a.animal).toLowerCase())} fall with it` : ''}.`, created);
  }, {
    desc: 'Invent a new weather (rains anything)', category: 'Sky',
    params: {
      name: { type: 'string', required: true }, base: { type: 'enum', values: (u) => u.content.weather.ids(), default: 'rain' }, precip: { type: 'enum', values: [...PRECIP_TYPES], default: 'rain' },
      animal: { type: 'string' }, like: { type: 'string' }, tint: { type: 'any' }, pos: iPos, radius: { type: 'number', min: 50, max: 20000, default: 600 },
      duration: { type: 'number', min: 10, max: 1e6, default: 720 }, intensity: { type: 'number', min: 0.1, max: 3, default: 1 }, paint: { type: 'boolean', default: true },
    },
  });
  r.register('content.animal', ({ u, p }, a) => {
    const name = String(a.name).trim().slice(0, 40);
    if (!name) return fail('Name the animal.');
    const sp = makeAnimal(u, p, name, typeof a.like === 'string' ? a.like : undefined);
    const n = Math.max(1, Math.round(Number(a.count ?? 8)));
    const h = dropHerd(u, p, sp, norm(a.pos ?? herePos(u, p)), n);
    return h ? ok(`${titleCase(plural(name.toLowerCase()))} walk the world: a herd of ${n}.`, [{ kind: 'animal', id: h, planet: p.id }]) : ok(`${titleCase(plural(name.toLowerCase()))} now exist, but nowhere there can hold them.`);
  }, { desc: 'Invent a new animal', category: 'Life', params: { name: { type: 'string', required: true }, like: { type: 'enum', values: (u) => u.content.animals.ids() }, count: { type: 'int', min: 1, max: 10000, default: 8 }, pos: iPos } });
}

/** hourly: invented weathers that rain animals drop them where they fall */
export function rainsHourly(u: Universe, p: Planet): void {
  const rains = u.god.runtime.rains;
  if (!p.weather.length || !Object.keys(rains).length) return;
  for (const w of p.weather) {
    const def = u.content.weather.list[w.kind];
    const animal = def ? rains[def.id] : undefined;
    if (!animal) continue;
    const x = makeCtx(u, p);
    const sp = animalIdx(x, animal);
    if (sp < 0) continue;
    const near = x.ps.herds.find((h) => h.species === sp && h.cell === p.cellAt(w.pos));
    if (near) near.count = Math.round((near.count + 2 * w.intensity) * 1000) / 1000;
    else dropHerd(u, p, sp, w.pos, Math.max(2, Math.round(4 * w.intensity)));
  }
}
