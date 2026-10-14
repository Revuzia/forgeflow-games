// GENESIS — LIVING CONTENT (LIVING.md §4.1, §4.2): materials the god invents, and veins of ore the god lays down.
//
//   content.material { name, kind?, source?, traits?, uses?, seed?: { pos, radius }, settlement? }
//       A new material becomes real content (the runtime pack, god/runtime.ts; saved in the god state): its raw item
//       (for a metal an ore and the smelted metal), a deposit kind (ores) or a wild plant that gives it, a building
//       material when it builds (strength, warmth, fire and night light from its traits), the crafts that work it
//       (`<x> working` and its kin, prerequisites by kind) and its uses — tools with a quality bonus of 15-40 % from
//       its traits, blades, ornaments — and the gathering that brings it in (mining, quarrying, cutting, picking).
//       Deposits: where it is seeded (`seed`), else three veins by geology (metal: mountains; stone: mountains and
//       old sea floor; gem: volcanic and mountain country). A settlement named learns its crafts (the god shows them);
//       one that knows a craft using it wants it, so its miners and gatherers go for it (people/settlement.ts planJobs
//       and planWants: materialJobs below). The chronicle tells the first mined, the first tools and the first house of it.
//   terrain.seed-ore { ore, pos, radius = 120 m, richness = 0.7 }
//       Writes a deposit (`oreType` = 1 + the ore's index, `ore` richness falling off from the centre), never in water;
//       the settlements near it see it at their next look around (their resource caches refresh), and it is a small
//       wonder to those who watch. Event `ore.seeded`.
//   queries: `ores` (every deposit kind, invented ones marked, with its item and the cells of it on the world),
//            `materials` (the building materials with the invented ones' kind, traits, uses, deposits and crafts),
//            `content` (what the god made: the renderer draws invented plants, ores and materials from it — hook H12)

import type { CommandRegistry, ParamSchema } from './commands.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { ItemDef, MaterialDef, OreDef, PlantDef, RecipeDef, Era } from '../content.ts';
import type { PCtx } from '../people/ctx.ts';
import type { Settlement } from '../people/state.ts';
import type { MadeMaterial } from './state.ts';
import type { V3 } from './state.ts';
import { hash32, hashFloat } from '../core/rng.ts';
import { makeCtx } from '../people/ctx.ts';
import { AgentFlag } from '../types.ts';
import { godTeach } from '../people/knowledge.ts';
import { storeHas } from '../people/store.ts';
import { tell } from '../people/story.ts';
import { witness } from '../people/culture.ts';
import { distM } from '../people/world.ts';
import { rebuildContent, slug, titleCase } from './runtime.ts';
import { fail, herePos, nearestSettlement, norm, ok, placeName } from './util.ts';
import { makePlant } from './plantsrt.ts';
import { plantArea } from '../fields/vegetation.ts';

export const MATERIAL_KINDS = ['metal', 'stone', 'mineral', 'gem', 'wood', 'fibre'] as const;
export type MaterialKind = (typeof MATERIAL_KINDS)[number];
export const MATERIAL_USES = ['building', 'tools', 'weapons', 'luxury'] as const;
export const MATERIAL_TRAITS = ['hard', 'light', 'warm', 'glowing', 'flexible', 'beautiful', 'fireproof', 'sharp'] as const;

/** the uses a material of each kind has when none are named */
const DEFAULT_USES: Record<MaterialKind, string[]> = {
  metal: ['tools', 'weapons', 'luxury'], stone: ['building', 'tools'], mineral: ['luxury'], gem: ['luxury'], wood: ['building', 'tools'], fibre: ['luxury'],
};
/** where its deposits form (ores.json geology weights) */
const GEOLOGY: Record<MaterialKind, Record<string, number>> = {
  metal: { mountain: 1, volcanic: 0.4 }, stone: { mountain: 0.6, sedimentary: 1 }, gem: { volcanic: 1, mountain: 0.6 }, mineral: { basin: 1, sedimentary: 0.6 },
  wood: {}, fibre: {},
};
/** the idea that working it builds on, by kind (a people must know it before they can learn the craft) */
const PREREQ: Record<MaterialKind, string[]> = {
  metal: ['copper-smelting'], stone: ['masonry'], gem: ['jewellery'], mineral: ['clay-digging'], wood: ['carpentry'], fibre: ['weaving'],
};
const ERA_OF: Record<MaterialKind, Era> = { metal: 'bronze', stone: 'bronze', gem: 'bronze', mineral: 'clay', wood: 'bronze', fibre: 'clay' };
/** tool quality of the kind's own tools (items.json: stone 1, bronze 1.6), before the traits' bonus */
const TOOL_Q: Record<MaterialKind, number> = { metal: 1.6, stone: 1.0, gem: 1.1, mineral: 0.9, wood: 0.8, fibre: 0.6 };

/** a material's kind and traits guessed from its words ('mithril' → metal; 'a light, glowing stone' → stone, light, glowing) */
export function guessMaterial(u: Universe, words: string): { kind: MaterialKind; traits: string[] } {
  const L = u.content.lexicon as Record<string, unknown>;
  const kinds = (L.materialKinds ?? {}) as Record<string, string[]>;
  const traitsL = (L.materialTraits ?? {}) as Record<string, string[]>;
  const w = ` ${String(words).toLowerCase().replace(/[^a-z0-9 -]+/g, ' ')} `;
  const hasW = (x: string) => w.includes(` ${x} `) || w.includes(` ${x}s `);
  let kind: MaterialKind | null = null;
  // the last kind word wins ('a stone called glowstone' and 'glowstone' both say stone; 'a metal called mithril': metal)
  let at = -1;
  for (const k of MATERIAL_KINDS) {
    for (const x of kinds[k] ?? []) {
      const i = w.lastIndexOf(` ${x} `);
      if (i >= 0 && hasW(x) && i > at) { at = i; kind = k; }
      // a name made of a kind word ('glowstone', 'ironwood'): the word inside the name
      if (!kind) for (const part of w.trim().split(' ')) if (part.length > x.length && (part.endsWith(x) || part.startsWith(x)) && x.length >= 4) kind = k;
    }
  }
  const traits: string[] = [];
  for (const t of MATERIAL_TRAITS) if ((traitsL[t] ?? [t]).some((x) => hasW(x))) traits.push(t);
  if (/glow|shin|light(?!weight)|lumin|radian/.test(w) && !traits.includes('glowing') && /glow|lumin|radian|shin/.test(w)) traits.push('glowing');
  return { kind: kind ?? 'stone', traits };
}

/** a stable hash of a string */
export function strHash(s: string, salt: number): number {
  let h = salt | 0;
  for (let i = 0; i < s.length; i++) h = hash32(h, s.charCodeAt(i));
  return h >>> 0;
}

/** the colour of a material from its name and traits (a stable hash; glowing ones pale and bright) */
function colourOf(id: string, kind: MaterialKind, traits: string[]): string {
  const h = strHash(id, 0xc01);
  const base: Record<MaterialKind, [number, number, number]> = { metal: [170, 180, 196], stone: [150, 142, 130], gem: [120, 60, 170], mineral: [210, 200, 170], wood: [120, 84, 52], fibre: [226, 218, 196] };
  let [r, g, b] = base[kind];
  r += (h & 31) - 16; g += ((h >> 5) & 31) - 16; b += ((h >> 10) & 31) - 16;
  if (traits.includes('glowing')) { r = (r + 255 * 2) / 3; g = (g + 250 * 2) / 3; b = (b + 200 * 2) / 3; }
  const hx = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

function putItem(r: { items: ItemDef[] }, def: ItemDef): void {
  const i = r.items.findIndex((x) => x.id === def.id);
  if (i >= 0) r.items[i] = def; else r.items.push(def);
}
function putRecipe(r: { recipes: RecipeDef[] }, def: RecipeDef): void {
  const i = r.recipes.findIndex((x) => x.id === def.id);
  if (i >= 0) r.recipes[i] = def; else r.recipes.push(def);
}
function recipe(id: string, name: string, kind: RecipeDef['kind'], skill: RecipeDef['skill'], era: Era, fields: Partial<RecipeDef>): RecipeDef {
  return {
    id, name, kind, inputs: [], tools: [], place: {}, knowledge: [], outputs: [], time: 0, skill, difficulty: 0.3,
    discover: { base: 0, triggers: [], curiosity: 0 }, teach: 0.35, era, ...fields,
  };
}

export interface MaterialSpec {
  name: string;
  kind?: MaterialKind;
  source?: 'ore' | 'plant';
  traits?: string[];
  uses?: string[];
}

/**
 * Make (or re-make) a material: its items, deposit kind or plant, building material, crafts and uses, in the runtime
 * pack. Returns what it made. Deterministic: ids from its name, numbers from its kind and traits.
 */
export function makeMaterial(u: Universe, spec: MaterialSpec): MadeMaterial {
  const name = String(spec.name).trim().slice(0, 40);
  const id = slug(name);
  const guess = guessMaterial(u, name);
  const kind: MaterialKind = spec.kind && (MATERIAL_KINDS as readonly string[]).includes(spec.kind) ? spec.kind : guess.kind;
  const traits = [...new Set([...(spec.traits ?? []).map(String).filter((t) => (MATERIAL_TRAITS as readonly string[]).includes(t)), ...guess.traits])].sort();
  const uses = [...new Set((spec.uses && spec.uses.length ? spec.uses : DEFAULT_USES[kind]).map(String).filter((x) => (MATERIAL_USES as readonly string[]).includes(x)))];
  const source: 'ore' | 'plant' = spec.source ?? (kind === 'wood' || kind === 'fibre' ? 'plant' : 'ore');
  const Name = titleCase(name);
  const r = u.god.runtime;
  r.made ??= {};
  const hard = traits.includes('hard'), light = traits.includes('light'), warm = traits.includes('warm'), glow = traits.includes('glowing');
  const pretty = traits.includes('beautiful'), flex = traits.includes('flexible'), sharp = traits.includes('sharp'), fireproof = traits.includes('fireproof');
  const value = (pretty ? 2 : 1) * (kind === 'gem' ? 6 : kind === 'metal' ? 3 : 1);
  const colour = colourOf(id, kind, traits);
  const goods: string[] = [];
  const recipes: string[] = [];
  // ── the items: raw (from the ground or the plant), worked, and what it is built with
  const raw = kind === 'metal' ? `${id}-ore` : id;
  const worked = kind === 'metal' ? id : kind === 'stone' ? `${id}-block` : kind === 'gem' ? `${id}-jewel` : kind === 'wood' ? `${id}-timber` : kind === 'fibre' ? `${id}-cloth` : `${id}-refined`;
  const rawTags: Record<MaterialKind, string[]> = { metal: ['ore', 'raw'], stone: ['stone', 'raw', 'material'], gem: ['gem', 'raw', 'precious'], mineral: ['mineral', 'raw'], wood: ['wood', 'raw', 'material', 'fuel'], fibre: ['raw', 'fibre'] };
  const workTags: Record<MaterialKind, string[]> = { metal: ['metal', 'material'], stone: ['material', 'building', 'stone'], gem: ['luxury', 'precious', 'gem'], mineral: ['mineral', 'material'], wood: ['material', 'building', 'wood', 'fuel'], fibre: ['material', 'cloth'] };
  const it = (iid: string, nm: string, tags: string[], extra: Partial<ItemDef> = {}): void => {
    putItem(r, { id: iid, name: nm, tags: [...new Set([...tags, 'invented'])].sort(), weight: light ? 0.6 : kind === 'stone' ? 4 : 1.5, value, ...extra });
  };
  it(raw, kind === 'metal' ? `${Name} ore` : Name, rawTags[kind], kind === 'wood' ? { fuel: 1 } : {});
  if (worked !== raw) it(worked, kind === 'metal' ? Name : kind === 'stone' ? `Dressed ${name}` : kind === 'gem' ? `Cut ${name}` : kind === 'wood' ? `${Name} timber` : kind === 'fibre' ? `${Name} cloth` : `Refined ${name}`, workTags[kind], { value: value * 2, ...(kind === 'wood' ? { fuel: 0.9 } : {}) });
  // ── the deposit kind, or the plant that gives it
  let ore: string | undefined, plant: string | undefined;
  if (source === 'ore') {
    ore = id;
    const o: OreDef = { id, name: kind === 'metal' ? `${Name} ore` : Name, color: colour, rarity: 0.2, geology: { ...(GEOLOGY[kind] ?? { mountain: 1 }) }, item: raw };
    r.ores ??= [];
    const oi = r.ores.findIndex((x) => x.id === id);
    if (oi >= 0) r.ores[oi] = o; else r.ores.push(o);
  } else {
    plant = makePlantDef(u, kind === 'wood' ? `${name} tree` : `${name} plant`, kind === 'wood' ? 'tree' : 'shrub', raw);
  }
  // ── gathering it: mining, quarrying, felling, picking
  const gTask = source === 'plant' ? (kind === 'wood' ? 'chop' : 'forage') : kind === 'stone' ? 'quarry' : 'mine';
  const gId = `${id}-${gTask === 'mine' ? 'mining' : gTask === 'quarry' ? 'quarrying' : gTask === 'chop' ? 'felling' : 'picking'}`;
  const gKnow = gTask === 'mine' ? ['mining'] : gTask === 'quarry' ? ['quarrying'] : gTask === 'chop' ? ['woodcutting'] : ['foraging'];
  putRecipe(r, recipe(gId, `${gTask === 'mine' ? 'Mining' : gTask === 'quarry' ? 'Quarrying' : gTask === 'chop' ? 'Felling' : 'Picking'} ${name}`, 'gather', 'gather', kind === 'metal' || kind === 'gem' ? 'bronze' : 'stone', {
    knowledge: gKnow.filter((k) => u.content.recipes.has(k)), gather: { task: gTask, items: [raw] }, desc: `Where ${name} is found, and how to get it out (an invention of the god).`,
  }));
  recipes.push(gId);
  // ── working it
  const pre = PREREQ[kind].filter((k) => u.content.recipes.has(k));
  if (worked !== raw) {
    const wId = `${id}-working`;
    const hot = kind === 'metal';
    putRecipe(r, recipe(wId, `${Name} working`, 'craft', hot ? 'smith' : kind === 'gem' ? 'smith' : 'craft', ERA_OF[kind], {
      inputs: hot ? [{ item: raw, qty: 2 }, { tag: 'charcoal', qty: 1 }] : [{ item: raw, qty: kind === 'gem' ? 1 : 2 }],
      tools: hot ? [] : kind === 'stone' ? ['pound'] : kind === 'gem' ? ['cut'] : kind === 'wood' ? ['chop'] : [],
      place: hot ? { needs: ['kiln'], heat: 950 } : {}, knowledge: pre, outputs: [{ item: worked, qty: kind === 'wood' ? 2 : 1 }], time: hot ? 200 : 150,
      difficulty: 0.3, desc: `Working ${name} into ${kind === 'metal' ? 'metal' : 'something that can be used'} (an invention of the god).`,
    }));
    recipes.push(wId);
  }
  // ── its uses: tools (+15-40 % over the kind's own by its traits), blades, ornaments
  const bonus = 0.15 + 0.25 * Math.min(1, [hard, sharp, light, flex].filter(Boolean).length / 2);
  const q = Math.round(TOOL_Q[kind] * (1 + bonus) * 100) / 100;
  const tmade = [...(hard || sharp ? ['cut', 'chop', 'dig', 'saw', 'pound'] : ['cut', 'dig', 'pound']), 'tool'];
  const useInputs = (n: number) => [{ item: worked, qty: n }, ...(kind === 'metal' ? [] : [{ item: 'stick', qty: 1 }])].filter((io) => u.content.items.has(io.item) || io.item === worked);
  const heatPlace = kind === 'metal' ? { needs: ['kiln'], heat: 900 } : {};
  if (uses.includes('tools')) {
    const tId = `${id}-tools`;
    putItem(r, { id: tId, name: `${Name} tools`, tags: [...new Set([...tmade, 'invented'])].sort(), weight: light ? 1 : 2, value: value * 3, quality: q });
    putRecipe(r, recipe(tId, `${Name} tools`, 'craft', kind === 'metal' ? 'smith' : 'craft', ERA_OF[kind], {
      inputs: useInputs(1), place: heatPlace, knowledge: [worked !== raw ? `${id}-working` : gId], outputs: [{ item: tId, qty: 1 }], time: 160, difficulty: 0.3,
      desc: `Tools of ${name}: ${Math.round(bonus * 100)} % better than the ${kind === 'metal' ? 'bronze' : kind} tools they knew (an invention of the god).`,
    }));
    goods.push(tId); recipes.push(tId);
  }
  if (uses.includes('weapons')) {
    const bId = `${id}-blade`;
    putItem(r, { id: bId, name: `${Name} blade`, tags: ['blade', 'hunt', 'invented', 'weapon'], weight: light ? 1 : 2, value: value * 3, quality: q });
    putRecipe(r, recipe(bId, `${Name} blades`, 'craft', kind === 'metal' ? 'smith' : 'craft', ERA_OF[kind], {
      inputs: useInputs(1), place: heatPlace, knowledge: [worked !== raw ? `${id}-working` : gId], outputs: [{ item: bId, qty: 1 }], time: 160, difficulty: 0.35,
      desc: `Blades and spearheads of ${name} (an invention of the god).`,
    }));
    goods.push(bId); recipes.push(bId);
  }
  if (uses.includes('luxury')) {
    const oId = `${id}-ornaments`;
    putItem(r, { id: oId, name: `${Name} ornaments`, tags: ['invented', 'luxury', 'precious'], weight: 0.2, value: value * 4 });
    putRecipe(r, recipe(oId, `${Name} ornaments`, 'craft', 'craft', ERA_OF[kind], {
      inputs: [{ item: worked, qty: 1 }], tools: ['cut'], knowledge: [worked !== raw ? `${id}-working` : gId], outputs: [{ item: oId, qty: 2 }], time: 120, difficulty: 0.3,
      desc: `Ornaments of ${name}, worn at feasts (an invention of the god).`,
    }));
    goods.push(oId); recipes.push(oId);
  }
  // ── a building material, and the buildings that take it
  let material: string | undefined;
  if (uses.includes('building')) {
    material = id;
    const baseStrength: Record<MaterialKind, number> = { metal: 3, stone: 2, gem: 2.2, mineral: 1.5, wood: 1.1, fibre: 0.3 };
    const baseIns: Record<MaterialKind, number> = { metal: 0.5, stone: 0.7, gem: 0.6, mineral: 0.65, wood: 0.7, fibre: 0.35 };
    const flam: Record<MaterialKind, number> = { metal: 0, stone: 0, gem: 0, mineral: 0.05, wood: 0.8, fibre: 0.9 };
    const m: MaterialDef = {
      id, name: Name, items: [{ item: worked, qty: kind === 'stone' ? 1 : 2 }], knowledge: worked !== raw ? `${id}-working` : gId, color: colour,
      roughness: kind === 'metal' ? 0.35 : kind === 'gem' ? 0.15 : 0.7, pattern: kind === 'wood' ? 'planks' : kind === 'fibre' ? 'canvas' : kind === 'metal' ? 'plated' : 'ashlar',
      flammability: fireproof ? 0 : flam[kind], strength: Math.round(baseStrength[kind] * (hard ? 1.5 : 1) * (light ? 0.85 : 1) * 100) / 100,
      insulation: Math.min(1, Math.round((baseIns[kind] + (warm ? 0.2 : 0)) * 100) / 100), era: ERA_OF[kind], ...(glow ? { light: 1 } : {}),
    };
    r.materials ??= [];
    const mi = r.materials.findIndex((x) => x.id === id);
    if (mi >= 0) r.materials[mi] = m; else r.materials.push(m);
    // the worked item stands for the material (render hint)
    const wi = r.items.findIndex((x) => x.id === worked);
    if (wi >= 0) r.items[wi] = { ...r.items[wi], material: id, tags: [...new Set([...r.items[wi].tags, 'building', 'material'])].sort() };
    // every building raised in a material of its kind may be raised in it, and is first (the god's gift is prized)
    const like: Record<MaterialKind, string[]> = { metal: ['stone', 'steel', 'brick'], stone: ['stone', 'fieldstone', 'brick', 'mudbrick'], gem: ['stone', 'fieldstone'], mineral: ['stone', 'fieldstone', 'mudbrick'], wood: ['timber', 'wood', 'wattle'], fibre: ['cloth', 'hide'] };
    r.buildingMats ??= {};
    for (const b of u.content.buildings.list) {
      if (!b.materials.some((x) => like[kind].includes(x))) continue;
      const l = (r.buildingMats[b.id] ??= []);
      if (!l.includes(id)) l.push(id);
    }
  }
  const made: MadeMaterial = { name: Name, kind, traits, uses, raw, worked, ...(material ? { build: worked, material } : {}), goods, recipes, ...(ore ? { ore } : {}), ...(plant ? { plant } : {}), tick: u.tick };
  r.made[id] = made;
  rebuildContent(u);
  return made;
}

/** a wild plant that gives an invented material (wood, fibre): a runtime plant like the nearest of its kind */
function makePlantDef(u: Universe, name: string, type: 'tree' | 'shrub', item: string): string {
  return makePlant(u, { name, type, like: type === 'tree' ? 'oak' : 'berry-bush', yields: { item, tags: [] } }, false).id;
}

// ───────────────────────────── deposits ─────────────────────────────

/**
 * Lay a deposit of ore `oi` (ore index) around pos: richness `rich` at the centre falling off to the edge of `radius`,
 * never in water; a cell's richer deposit of another kind is kept. Returns the cells written.
 */
export function seedOre(p: Planet, oi: number, pos: ArrayLike<number>, radius: number, rich: number, force = false): number {
  const f = p.f;
  const P = p.grid.pos;
  const R = Math.max(radius, p.edgeM * 0.6);
  let n = 0;
  for (const c of p.cellsNear(pos, R)) {
    if (p.s.ocean[c] || f.water[c] > 0.3) continue;
    const d = distM(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], pos) / R;
    const v = Math.min(1, rich * (1 - 0.6 * d * d));
    if (v <= 0.05) continue;
    // (a natural vein keeps a cell's richer deposit of another kind; the god's own vein replaces it)
    if (!force && f.oreType[c] > 0 && f.oreType[c] !== oi + 1 && f.ore[c] > v) continue;
    f.oreType[c] = oi + 1;
    f.ore[c] = Math.max(f.oreType[c] === oi + 1 ? f.ore[c] : 0, Math.round(v * 1000) / 1000);
    n++;
  }
  if (n) { p.bump('ore'); p.bump('oreType'); }
  return n;
}

/** the settlements within reach of pos look around again at their next hour (their resource caches refresh) */
function staleNear(p: Planet, pos: ArrayLike<number>, m: number): void {
  for (const st of p.people?.settlements ?? []) if (st.fallen < 0 && distM(p, st.pos, pos) < m + st.territory) st.recent.waterStale = p.people.now;
}

/** geology score of cell c for a deposit kind (as world/planet.ts places ores: high and steep, volcanic, low and flat …) */
function geoScore(p: Planet, c: number, w: Record<string, number>): number {
  const f = p.f;
  const alt = f.surface[c] - p.st.seaLevel;
  if (alt <= 0 || f.water[c] > 0.3 || p.s.ocean[c]) return 0;
  const mountain = Math.min(1, Math.max(0, (alt - 100) / 200));
  const volcanic = f.lava[c] > 0 || f.ash[c] > 0.05 ? 1 : 0;
  const sedimentary = alt < 80 ? 0.8 : 0;
  const basin = f.water[c] > 0.02 && alt < 60 ? 0.6 : 0;
  return (w.mountain ?? 0) * mountain + (w.volcanic ?? 0) * volcanic + (w.sedimentary ?? 0) * sedimentary + (w.basin ?? 0) * basin + 0.05;
}

/** three veins of ore oi by its geology (cells drawn by a hash, at least 1 km apart): the god's new ore in the world */
export function naturalVeins(p: Planet, oi: number, geology: Record<string, number>, salt: number): number {
  const picked: number[] = [];
  let n = 0;
  for (let v = 0; v < 3; v++) {
    let best = -1, bv = 0;
    for (let k = 0; k < 64; k++) {
      const c = hash32(salt, v, k, p.seed ^ 0x0e1) % p.count;
      const P = p.grid.pos;
      if (picked.some((q) => distM(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], [P[q * 3], P[q * 3 + 1], P[q * 3 + 2]]) < 1000)) continue;
      const s = geoScore(p, c, geology) * (0.6 + 0.4 * hashFloat(c, salt, 0x0e2));
      if (s > bv) { bv = s; best = c; }
    }
    if (best < 0) continue;
    picked.push(best);
    const P = p.grid.pos;
    n += seedOre(p, oi, [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]], 120, 0.7);
  }
  return n;
}

/** a dry land spot near a settlement for a vein: 200-350 m out, on high ground if there is any (or -1) */
function veinSpotNear(p: Planet, st: Settlement, salt: number): V3 | null {
  const P = p.grid.pos;
  let best = -1, bv = -1;
  for (const c of p.cellsNear(st.pos, Math.max(400, p.edgeM * 2.5))) {
    if (p.s.ocean[c] || p.f.water[c] > 0.2) continue;
    const d = distM(p, [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], st.pos);
    if (d < Math.min(150, p.edgeM * 0.6) || d > Math.max(380, p.edgeM * 2.2)) continue;
    if (p.people.bByCell.get(c).length || st.fields.includes(c)) continue;
    const v = p.f.surface[c] - p.st.seaLevel + 40 * hashFloat(c, salt, 0x0e3);
    if (v > bv) { bv = v; best = c; }
  }
  return best < 0 ? null : [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]];
}

// ───────────────────────────── demand and firsts ─────────────────────────────

/**
 * The crafts of the god's materials a settlement knows and can work now (people/settlement.ts planJobs): refining what
 * it has dug, and making it into tools, blades and ornaments — a people that knows a use of a new material wants it.
 */
export function materialJobs(x: PCtx, st: Settlement): number[] {
  const made = x.u.god.runtime.made;
  if (!made) return [];
  const out: number[] = [];
  for (const id of Object.keys(made).sort()) {
    const m = made[id];
    for (const rid of m.recipes) {
      const k = x.rt.byId.get(rid);
      if (k === undefined || !st.library.includes(k) || x.rt.list[k].kind !== 'craft') continue;
      // tools and blades only while there are hands for them
      const outIt = x.rt.list[k].outItems[0]?.[0] ?? -1;
      if (outIt >= 0 && storeHas(st, outIt) >= 6) continue;
      out.push(k);
    }
  }
  return out;
}

/** daily: the first of an invented material mined, worked into tools, built with — told once per settlement */
export function materialsDaily(u: Universe, p: Planet): void {
  const made = u.god.runtime.made;
  const ps = p.people;
  if (!made || !ps || !ps.settlements.length) return;
  const x = makeCtx(u, p);
  for (const id of Object.keys(made).sort()) {
    const m = made[id];
    const raw = x.c.items.idx(m.raw);
    const mat = m.material ? x.c.materials.idx(m.material) : -1;
    for (const st of ps.settlements) {
      if (st.fallen >= 0 || st.band) continue;
      const first = (key: string, text: string) => {
        if (st.firsts[key] !== undefined) return;
        st.firsts[key] = x.tick;
        u.chronicleAdd(p, 'discovery', text, 1);
        u.emit({ t: 'material.first', planet: p.id, pos: [st.pos[0], st.pos[1], st.pos[2]], text: key, data: { settlement: st.id, material: id, what: key.split(':')[0] } });
      };
      if (raw >= 0 && storeHas(st, raw) > 0) first(`mined:${id}`, `${st.name} brought in the first ${m.kind === 'metal' ? `${m.name.toLowerCase()} ore` : m.name.toLowerCase()} ever won from the ground.`);
      for (const g of m.goods) { const gi = x.c.items.idx(g); if (gi >= 0 && (storeHas(st, gi) > 0 || carriedBy(x, st, gi))) first(`made:${g}`, `The first ${x.c.items.list[gi].name.toLowerCase()} were made at ${st.name}.`); }
      if (mat >= 0 && ps.of(st.id).some((b) => b.material === mat && b.progress >= 1)) first(`built:${id}`, `${st.name} raised its first house of ${m.name.toLowerCase()}.`);
    }
  }
}

function carriedBy(x: PCtx, st: Settlement, it: number): boolean {
  for (const s of x.ps.members.get(st.id) ?? []) if (x.A.tool[s] === it || x.A.carried(s, it) > 0) return true;
  return false;
}

// ───────────────────────────── queries ─────────────────────────────

/** every deposit kind (invented ones marked) with its item and, on world p, the cells of it */
export function oresQuery(u: Universe, p: Planet | undefined): unknown {
  const base = u.content.sources[0]?.ores?.length ?? 0;
  const cells = new Map<number, number>();
  if (p) for (let c = 0; c < p.count; c++) { const o = p.f.oreType[c]; if (o > 0) cells.set(o - 1, (cells.get(o - 1) ?? 0) + 1); }
  return u.content.ores.list.map((o, i) => ({ id: o.id, name: o.name, color: o.color, item: o.item ?? null, invented: i >= base, cells: cells.get(i) ?? 0 }));
}

/** the building materials, the invented ones with their kind, traits, uses, deposits and crafts */
export function materialsQuery(u: Universe, p: Planet | undefined): unknown {
  const made = u.god.runtime.made ?? {};
  const ores = oresQuery(u, p) as { id: string; cells: number }[];
  const out: unknown[] = u.content.materials.list.map((m) => {
    const inv = made[m.id];
    return inv ? { ...m, invented: true, kind: inv.kind, traits: inv.traits, uses: inv.uses, crafts: inv.recipes, goods: inv.goods, deposits: ores.find((o) => o.id === inv.ore)?.cells ?? 0 } : m;
  });
  // invented materials that do not build: listed too (their crafts and deposits)
  for (const id of Object.keys(made).sort()) {
    if (u.content.materials.has(id)) continue;
    const inv = made[id];
    out.push({ id, name: inv.name, invented: true, building: false, kind: inv.kind, traits: inv.traits, uses: inv.uses, crafts: inv.recipes, goods: inv.goods, deposits: ores.find((o) => o.id === inv.ore)?.cells ?? 0, plant: inv.plant ?? null });
  }
  return out;
}

/** what the god made: plants, deposit kinds, building materials, items and crafts past the base content (hook H12) */
export function contentQuery(u: Universe): unknown {
  const base = u.content.sources[0];
  const tail = <T extends { id: string }>(list: T[], n: number) => list.slice(n).map((e, k) => ({ index: n + k, ...e }));
  return {
    plants: tail(u.content.plants.list, base?.plants?.length ?? 0), ores: tail(u.content.ores.list, base?.ores?.length ?? 0),
    materials: tail(u.content.materials.list, base?.materials?.length ?? 0), items: tail(u.content.items.list, base?.items?.length ?? 0),
    recipes: u.content.recipes.list.slice(base?.recipes?.length ?? 0).map((r) => r.id), made: u.god.runtime.made ?? {},
  };
}

// ───────────────────────────── commands ─────────────────────────────

const mPos: ParamSchema = { type: 'pos', desc: 'where (unit vector or lat/lon)' };

export function registerMaterialCommands(r: CommandRegistry): void {
  r.register('terrain.seed-ore', ({ u, p }, a) => {
    const ore = u.content.ores.idx(String(a.ore));
    if (ore < 0) return fail(`There is no ore called '${a.ore}' (the god can make one: "create a metal called …").`);
    const pos = norm(a.pos ?? herePos(u, p));
    const c = p.cellAt(pos);
    if (p.s.ocean[c] || p.f.water[c] > 0.5) return fail('A vein of ore cannot lie under water: choose dry land.');
    const radius = Number(a.radius ?? 120), rich = Number(a.richness ?? 0.7);
    const n = seedOre(p, ore, pos, radius, rich, true);
    if (!n) return fail(`Nowhere ${placeName(p, pos)} can hold a vein.`);
    staleNear(p, pos, radius + 1500);
    witness(p, pos, radius + 200, 'wonder', 0.15);
    const o = u.content.ores.list[ore];
    u.emit({ t: 'ore.seeded', planet: p.id, pos, text: o.id, data: { ore: o.id, cells: n, radius, richness: rich } });
    return ok(`A vein of ${o.name.toLowerCase()} lies ${placeName(p, pos)} (${n} cell${n === 1 ? '' : 's'}).`);
  }, {
    desc: 'Lay a vein of ore in the ground', category: 'Shape',
    params: {
      ore: { type: 'enum', values: (u) => u.content.ores.ids(), required: true }, pos: mPos,
      radius: { type: 'number', min: 20, max: 5000, default: 120 }, richness: { type: 'number', min: 0.05, max: 1, default: 0.7 },
    },
  });

  r.register('content.material', ({ u, p, cmd }, a) => {
    const name = String(a.name ?? '').trim().slice(0, 40);
    if (!name) return fail('Name the material.');
    const id = slug(name);
    if (u.content.items.has(id) && !u.god.runtime.made?.[id] && !(u.god.runtime.items ?? []).some((x) => x.id === id)) {
      return fail(`${titleCase(name)} is already a thing of this world (an item): name the new material differently.`);
    }
    const kind = typeof a.kind === 'string' ? a.kind as MaterialKind : undefined;
    const traits = Array.isArray(a.traits) ? (a.traits as unknown[]).map(String) : typeof a.traits === 'string' ? [a.traits] : undefined;
    const uses = Array.isArray(a.uses) ? (a.uses as unknown[]).map(String) : typeof a.uses === 'string' ? [a.uses] : undefined;
    const m = makeMaterial(u, { name, kind, traits, uses, source: a.source === 'plant' || a.source === 'ore' ? a.source : undefined });
    const parts: string[] = [];
    // where it lies: the vein asked for, near the settlement named, and by its geology elsewhere
    const st = a.settlement !== undefined && p.people ? settlementOf(p, a.settlement) : null;
    const seed = a.seed as { pos?: V3; radius?: number } | undefined;
    let cells = 0;
    if (m.ore) {
      const oi = u.content.ores.idx(m.ore);
      if (seed && seed.pos) {
        const pos = norm(seed.pos);
        cells += seedOre(p, oi, pos, Number(seed.radius ?? 120), 0.75, true);
        staleNear(p, pos, 2000);
        parts.push(`a vein ${placeName(p, pos)}`);
      } else if (st) {
        const at = veinSpotNear(p, st, hash32(st.id, u.tick, 0x0e4));
        if (at) { cells += seedOre(p, oi, at, 120, 0.75, true); staleNear(p, at, 2000); parts.push(`a vein near ${st.name}`); }
      }
      const g = (u.content.ores.list[oi]?.geology ?? {}) as Record<string, number>;
      const nat = naturalVeins(p, oi, g, hash32(oi, u.tick, 0x0e5));
      cells += nat;
      if (nat) parts.push(`${parts.length ? 'and ' : ''}veins in the ${m.kind === 'gem' ? 'volcanic and mountain country' : m.kind === 'metal' ? 'mountains' : 'hills and old sea floor'}`);
      if (cells) u.emit({ t: 'ore.seeded', planet: p.id, pos: seed?.pos ?? st?.pos ?? herePos(u, p), text: m.ore, data: { ore: m.ore, cells, invented: 1 } });
    } else if (m.plant) {
      const sp = u.content.plants.idx(m.plant);
      const at = seed?.pos ? norm(seed.pos) : st ? st.pos : herePos(u, p);
      const n = sp >= 0 ? plantArea(u, p, sp, at, Number(seed?.radius ?? (st ? st.territory + 150 : 200)), 0.6) : 0;
      if (n) parts.push(`${u.content.plants.list[sp].name.toLowerCase()} growing ${placeName(p, at)}`);
    }
    // a settlement named learns how to get it and work it (the god shows them)
    let taught = 0;
    if (st) {
      const x = makeCtx(u, p);
      const adults = (x.ps.members.get(st.id) ?? []).filter((s) => !(x.A.flags[s] & AgentFlag.child));
      for (const rid of m.recipes) {
        const k = x.rt.byId.get(rid);
        if (k === undefined) continue;
        const res = godTeach(x, adults, k);
        taught += res.taught;
      }
      staleNear(p, st.pos, 0);
      witness(p, st.pos, st.territory + 150, 'wonder', 0.25);
      tell(u, p, 'introduce', { settlement: st.name, item: m.name.toLowerCase(), people: x.c.species.list[st.species].plural, planet: p.name }, st, [{ kind: 'settlement', id: st.id, planet: p.id }], 1);
    }
    void cmd;
    const usesW = m.uses.length ? m.uses.join(', ') : 'nothing yet';
    return ok(`${m.name} is a new ${m.kind}${m.traits.length ? ` (${m.traits.join(', ')})` : ''}: ${parts.length ? parts.join(' ') : 'nowhere yet'}${cells ? ` — ${cells} cells` : ''}; good for ${usesW}; crafts: ${m.recipes.length}${st ? `; ${st.name} learns its ways (${taught} taught)` : ''}.`);
  }, {
    desc: 'Invent a new material (a metal, stone, gem, mineral, wood or fibre) with deposits, crafts and uses', category: 'Ideas',
    params: {
      name: { type: 'string', required: true }, kind: { type: 'enum', values: [...MATERIAL_KINDS] }, source: { type: 'enum', values: ['ore', 'plant'] },
      traits: { type: 'any', desc: 'hard, light, warm, glowing, flexible, beautiful, fireproof, sharp' }, uses: { type: 'any', desc: 'building, tools, weapons, luxury' },
      seed: { type: 'any', desc: '{ pos, radius }: where its vein lies' }, settlement: { type: 'any', desc: 'a settlement that learns its ways' }, pos: mPos,
    },
  });
}

function settlementOf(p: Planet, v: unknown): Settlement | null {
  const ps = p.people;
  if (typeof v === 'number') return ps.settlement(v) ?? null;
  if (typeof v === 'string') { const n = v.toLowerCase(); return ps.settlements.find((s) => s.name.toLowerCase() === n) ?? null; }
  return null;
}

/** the nearest settlement to a place (free text "near Aru") */
export function settlementNear(p: Planet, pos: ArrayLike<number>): Settlement | null {
  return nearestSettlement(p, pos, 1500);
}
