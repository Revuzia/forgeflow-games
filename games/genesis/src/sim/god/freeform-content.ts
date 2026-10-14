// GENESIS — free text for materials, plants and real animals (LIVING.md §4, §5.3: the CONTENT phrases). god/freeform.ts
// calls intentContent right after the RELATIONSHIP intents (freeform-signs.ts), before its own:
//
//   "seed a vein of copper near Aru", "put gold in the hills near Lune", "put iron ore in the hills"   terrain.seed-ore
//   "create a new metal called mithril and put it in the mountains"                     content.material + terrain.seed-ore
//   "invent a stone called glowstone that people build with"                           content.material { uses: building }
//   "introduce mithril to Aru", "give Aru 20 glowstone"                                content.material { settlement } (+ gift)
//   "grow a new plant called silverleaf", "invent a new crop called sunroot"           content.plant
//   "grow a blueberry bush near Aru", "plant apple trees", "introduce potatoes to Lune" life.plant / settlement.introduce crop
//   "summon a dragon" (crocodiles), "release a kraken near Lune" (whales), "bring unicorns to Aru" (wild horses),
//   "spawn ice beasts in the north" (musk oxen), "set loose sand crawlers in the desert" (caracals), "spawn lions on the
//   savanna", "unleash a plague of frogs"                                               life.spawn-animal / content.animal
//   "spawn zombies"                                                                    a polite refusal, nothing done
//   "send the four horsemen"                                                            plague and drought
//   "create a new species of people"                                                    not yet (said so), nothing invented
//
// The parser's own types are module-private: these functions see a clause through the structural `ContentClause`.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import type { Command } from '../types.ts';
import type { V3 } from './state.ts';
import { makeCtx } from '../people/ctx.ts';
import { animalIdx, habitatFit } from '../life/herds.ts';
import { distM } from '../people/world.ts';
import { animalSingular, animalWord, nearestReal, noSuchAnimal } from '../life/fauna.ts';
import { guessMaterial, MATERIAL_KINDS } from './materials.ts';
import { slug } from './runtime.ts';
import { cellPos3, norm } from './util.ts';

interface LiveName { name: string; kind: string; id: number; planet: number; pos?: V3 }

/** the parts of a parser clause these intents read (god/freeform.ts Clause, structurally) */
export interface ContentClause {
  cx: { u: Universe; p: Planet | undefined; live: LiveName[]; raw: string; made: Set<string>; asked: Command[] };
  s: string;
  full: string;
  mods: { place: { pos?: V3; planet?: number; settlement?: number; label: string; here?: boolean; everywhere?: boolean } | null; qty?: number; one?: boolean; nums: number[] };
  out: Command[];
  add(cmd: Command, label?: string): void;
  ask(msg: string, about?: string): boolean;
}

function wordAt(s: string, phrase: string): number {
  let i = s.indexOf(phrase);
  while (i >= 0) {
    const before = i === 0 || !/[a-z0-9]/.test(s[i - 1]);
    const after = i + phrase.length >= s.length || !/[a-z0-9]/.test(s[i + phrase.length]);
    if (before && after) return i;
    i = s.indexOf(phrase, i + 1);
  }
  return -1;
}
const has = (s: string, ...w: string[]): boolean => w.some((x) => wordAt(s, x) >= 0);

/** the material made earlier in this sentence ("… and put it in the mountains") */
const lastMade = new WeakMap<object, { id: string; ore: boolean }>();

/** the place a clause names, else the camera's spot on the acting world */
function placeOf(c: ContentClause): V3 | null {
  const pl = c.mods.place;
  if (pl?.pos) return pl.pos;
  const u = c.cx.u;
  if (u.focus && c.cx.p && u.focus.planet === c.cx.p.id) return [...u.focus.pos] as V3;
  return null;
}

/** the nearest cell of a kind of country (hills, mountains, a biome) to a point; null none on the world */
function nearestCountry(u: Universe, p: Planet, from: V3, kind: string, within = Infinity): V3 | null {
  const f = p.f;
  const bi = u.content.biomes.idx(kind);
  const test = (c: number): boolean => {
    if (p.s.ocean[c] || f.water[c] > 0.3) return false;
    const alt = f.surface[c] - p.st.seaLevel;
    switch (kind) {
      case 'mountains': case 'mountain': case 'peaks': return alt > 150;
      case 'hills': case 'hill': case 'cliffs': return alt > 40;
      case 'ground': case 'earth': case 'land': case 'rock': case 'rocks': case 'soil': return true;
      default: return bi >= 0 && f.biome[c] === bi;
    }
  };
  let best = -1, bd = Infinity, hi = -Infinity, hc = -1;
  for (let c = 0; c < p.count; c++) {
    if (!test(c)) continue;
    const d = distM(p, cellPos3(p, c), from);
    if (d > within) continue;
    if (d < bd) { bd = d; best = c; }
  }
  // high country: the highest ground near the nearest hill (a vein in the hills lies in them, not at their foot)
  if (best >= 0 && /mountain|peak|hill|cliff/.test(kind)) {
    for (const c of p.cellsNear(cellPos3(p, best), 600)) { if (p.s.ocean[c] || f.water[c] > 0.3) continue; if (f.surface[c] > hi) { hi = f.surface[c]; hc = c; } }
    if (hc >= 0) best = hc;
  }
  if (best < 0 && /mountain|peak|hill|cliff/.test(kind)) {
    // no hills at all: the highest ground within reach
    for (const c of p.cellsNear(from, Math.min(within, 3000))) { if (p.s.ocean[c] || f.water[c] > 0.3) continue; if (f.surface[c] > hi) { hi = f.surface[c]; best = c; } }
  }
  return best >= 0 ? cellPos3(p, best) : null;
}

/** a dry spot a short walk out of a settlement (not on its houses): where a vein near a town is laid */
function besideTown(p: Planet, st: { pos: V3 }, salt: number): V3 {
  let best = -1, bv = -Infinity;
  for (const c of p.cellsNear(st.pos, Math.max(450, p.edgeM * 2.5))) {
    if (p.s.ocean[c] || p.f.water[c] > 0.2) continue;
    const d = distM(p, cellPos3(p, c), st.pos);
    if (d < Math.min(150, p.edgeM * 0.6)) continue;
    const v = p.f.surface[c] - p.st.seaLevel - Math.abs(d - 300) * 0.1 + ((c * 2654435761 + salt) >>> 0) / 4294967296 * 5;
    if (v > bv) { bv = v; best = c; }
  }
  return best >= 0 ? cellPos3(p, best) : st.pos;
}

// ───────────────────────────── ores and materials ─────────────────────────────

/** an ore the words name ('gold', 'iron ore', 'copper', 'gems', an invented one) — its id, or null */
function oreNamed(u: Universe, w: string): string | null {
  const t = w.trim().toLowerCase().replace(/^(some|a|an|the)\s+/, '').replace(/\s+(ore|ores|vein|veins|deposit|deposits)$/, '');
  if (!t) return null;
  const alias: Record<string, string> = { gem: 'gems', gemstones: 'gems', gemstone: 'gems', jewels: 'gems', diamonds: 'gems', rubies: 'gems', emeralds: 'gems', sapphires: 'gems', petroleum: 'oil', 'crude oil': 'oil', brimstone: 'sulfur', sulphur: 'sulfur', nitre: 'saltpeter', saltpetre: 'saltpeter', 'rock salt': 'salt', sand: 'glass-sand', 'glass sand': 'glass-sand' };
  const id = alias[t] ?? t.replace(/\s+/g, '-');
  for (const o of u.content.ores.list) if (o.id === id || o.name.toLowerCase() === t || o.name.toLowerCase() === `${t} ore` || o.item === id || o.item === `${id}-ore`) return o.id;
  const sg = animalSingular(t);
  if (sg !== t) return oreNamed(u, sg);
  return null;
}

/** is this word a material the god could invent (a known material word, or a name built on a kind's word: glowstone) */
function materialLike(u: Universe, w: string): boolean {
  const L = u.content.lexicon as Record<string, unknown>;
  const kinds = (L.materialKinds ?? {}) as Record<string, string[]>;
  const t = w.trim().toLowerCase();
  if (!t || t.split(' ').length > 2) return false;
  for (const k of MATERIAL_KINDS) for (const x of kinds[k] ?? []) {
    if (t === x || t === `${x}s`) return true;
    if (x.length >= 4 && t.length > x.length + 1 && (t.endsWith(x) || t.startsWith(x))) return true;
  }
  return /(ium|ite|ine|alum|metal|stone|wood|silk)$/.test(t) && t.length > 5;
}

const NEW_KIND = /\b(?:new |an? )?(metal|alloy|stone|rock|gem|gemstone|jewel|crystal|mineral|wood|timber|fibre|fiber|cloth|material|ore)\b(?:,? (?:called|named|known as))? ([a-z][a-z-]*(?: [a-z][a-z-]*)?)/;
const KIND_OF: Record<string, string> = { metal: 'metal', alloy: 'metal', ore: 'metal', stone: 'stone', rock: 'stone', gem: 'gem', gemstone: 'gem', jewel: 'gem', crystal: 'gem', mineral: 'mineral', wood: 'wood', timber: 'wood', fibre: 'fibre', fiber: 'fibre', cloth: 'fibre' };

function usesOf(s: string): string[] | undefined {
  const u: string[] = [];
  if (/\bbuild(s|ing)?\b|\bhouses?\b|\bwalls?\b|\bto build\b|\bconstruct/.test(s)) u.push('building');
  if (/\btools?\b|\bploughs?\b|\baxes?\b/.test(s)) u.push('tools');
  if (/\bweapons?\b|\bswords?\b|\bblades?\b|\bspears?\b|\barmou?r\b/.test(s)) u.push('weapons');
  if (/\bjewel(le)?ry\b|\bornaments?\b|\bluxur|\btrinkets?\b|\bbeautiful things\b|\bcrowns?\b/.test(s)) u.push('luxury');
  return u.length ? u : undefined;
}

function intentMaterial(c: ContentClause): boolean {
  const { s, cx, mods } = c;
  const { u, p } = cx;
  if (!p) return false;
  // "create a new metal called mithril", "invent a stone called glowstone that people build with"
  const makeV = /\b(create|invent|make|bring forth|conjure|devise|forge|bring into being|give the world)\b/.test(s);
  const m = s.match(NEW_KIND);
  if (makeV && m && /\b(called|named|known as|new)\b/.test(s) && !/\b(?:new|a|an) (?:plant|crop|tree|animal|species|people|race|tribe)\b|\bspecies of\b/.test(s)) {
    const name = m[2].replace(/\b(that|which|and|for|to|in|with|people|they)\b.*$/, '').trim();
    if (name && !u.content.items.has(slug(name)) && !/^(that|which|for|to)$/.test(name)) {
      const kind = KIND_OF[m[1]] === 'metal' && m[1] === 'material' ? undefined : KIND_OF[m[1]];
      const g = guessMaterial(u, `${name} ${s}`);
      const id = slug(name);
      const cmd: Command = { k: 'content.material', name, ...(kind ? { kind } : {}), ...(g.traits.length ? { traits: g.traits } : {}), ...(usesOf(s) ? { uses: usesOf(s) } : {}) };
      if (mods.place?.settlement !== undefined) cmd.settlement = mods.place.settlement;
      else if (mods.place?.pos) cmd.seed = { pos: mods.place.pos, radius: 150 };
      cx.made.add(id);
      lastMade.set(cx, { id, ore: (kind ?? g.kind) !== 'wood' && (kind ?? g.kind) !== 'fibre' });
      c.add(cmd, `a new ${kind ?? g.kind}: ${name}`);
      return true;
    }
  }
  // "introduce mithril to Aru", "give Aru 20 glowstone": a material the world never had, shown to a people
  const giveV = /\b(introduce|give|bring|gift|offer|show|reveal|teach)\b/.exec(s);
  if (giveV && mods.place?.settlement !== undefined) {
    const rest = s.slice(giveV.index + giveV[0].length).replace(/\b(to|for|unto)\b\s*$/, '').replace(/^\s*(them|the people|us)\s+/, '').replace(/\b(the people of|the town of)\b/g, '').trim();
    const words = rest.replace(/\b(\d+|a|an|some|the|of|to|and|lots|many|few|several|dozen|hundred)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (words && !u.content.items.has(slug(words)) && !u.content.recipes.has(slug(words)) && !u.content.plants.has(slug(words)) && materialLike(u, words) && animalWord(u.content, words).kind === 'none') {
      const id = slug(words);
      cx.made.add(id);
      lastMade.set(cx, { id, ore: true });
      c.add({ k: 'content.material', name: words, settlement: mods.place.settlement }, `a new material: ${words}`);
      if (giveV[1] !== 'introduce' && giveV[1] !== 'teach' && giveV[1] !== 'show' && giveV[1] !== 'reveal') c.add({ k: 'settlement.gift', settlement: mods.place.settlement, items: { [id]: Math.round(mods.qty ?? 10) } }, `${words} for them`);
      return true;
    }
  }
  return false;
}

function intentSeedOre(c: ContentClause): boolean {
  const { cx, mods } = c;
  const { u, p } = cx;
  if (!p) return false;
  // (the whole clause: "in the hills" may have been lifted out of the core as its place)
  const s = c.full;
  // "seed a vein of copper near Aru", "lay a seam of coal", "put gold in the hills", "bury iron ore under the mountains"
  const vein = s.match(/\b(?:seed|lay|put|place|make|create|hide|bury|plant|scatter|add|give)\b (?:a |an |some |rich |great |small |big |new )*(?:vein|veins|seam|seams|lode|lodes|deposit|deposits)(?: of)? ([a-z -]+?)(?=\s+(?:in|into|under|beneath|near|by|at|on|around)\b|$)/);
  const into = s.match(/\b(?:put|place|hide|bury|seed|scatter|add|sow|lay)\b (?:some |more |a lot of |lots of )?([a-z -]+?) (?:in|into|under|beneath|inside) (?:the )?(hills|hill|mountains|mountain|peaks|ground|earth|rock|rocks|soil|land|cliffs)\b/);
  const word = (vein?.[1] ?? into?.[1] ?? '').trim();
  if (!word) return false;
  const country = into?.[2] ?? (s.match(/\b(?:in|into|under|beneath) (?:the )?(hills|hill|mountains|mountain|peaks|cliffs)\b/)?.[1] ?? '');
  // the ore: a known one, the material made earlier in the sentence ("it"), or a new one
  let ore: string | null = null;
  if (/^(it|them|that|this)$/.test(word)) ore = lastMade.get(cx)?.id ?? null;
  else ore = oreNamed(u, word);
  if (!ore && /^(it|them|that|this)$/.test(word)) return false;
  if (!ore) {
    // a metal or stone the world never had: made here, then laid down
    if (u.content.items.has(slug(word)) || !materialLike(u, word)) return false;
    ore = slug(word);
    cx.made.add(ore);
    c.add({ k: 'content.material', name: word }, `a new material: ${word}`);
  }
  // where: the country named (near the place named), else a short walk out of the town named, else the place
  const base = placeOf(c);
  let pos: V3 | null = null;
  if (country && base) pos = nearestCountry(u, p, base, country, mods.place?.settlement !== undefined ? 2500 : Infinity);
  else if (country) pos = nearestCountry(u, p, [0, 0, 1], country);
  if (!pos && mods.place?.settlement !== undefined) {
    const st = p.people.settlement(mods.place.settlement);
    if (st) pos = besideTown(p, st as unknown as { pos: V3 }, st.id);
  }
  if (!pos) pos = base;
  c.add({ k: 'terrain.seed-ore', ore, ...(pos ? { pos: norm(pos) } : {}) }, `a vein of ${ore}`);
  return true;
}

// ───────────────────────────── plants and crops ─────────────────────────────

/** everyday plant words -> plants.json ids */
const PLANT_WORDS: Record<string, string> = {
  blueberry: 'berry-bush', blueberries: 'berry-bush', raspberry: 'berry-bush', raspberries: 'berry-bush', blackberry: 'berry-bush', blackberries: 'berry-bush',
  bilberry: 'berry-bush', strawberry: 'berry-bush', strawberries: 'berry-bush', elderberry: 'berry-bush', currant: 'berry-bush', currants: 'berry-bush',
  gooseberry: 'berry-bush', cranberry: 'berry-bush', huckleberry: 'berry-bush', berry: 'berry-bush', berries: 'berry-bush', bramble: 'berry-bush', 'berry bush': 'berry-bush',
  apple: 'apple', apples: 'apple', 'apple tree': 'apple', orchard: 'apple', olive: 'olive', olives: 'olive', 'olive tree': 'olive', 'olive grove': 'olive',
  date: 'date-palm', dates: 'date-palm', 'date palm': 'date-palm', 'date palms': 'date-palm', fig: 'fig', figs: 'fig', 'fig tree': 'fig',
  mushroom: 'mushrooms', mushrooms: 'mushrooms', herb: 'wild-herbs', herbs: 'wild-herbs',
  potato: 'potato', potatoes: 'potato', barley: 'barley', sorghum: 'sorghum', millet: 'sorghum', lentil: 'lentil', lentils: 'lentil', beans: 'lentil', peas: 'lentil',
  chickpeas: 'lentil', cotton: 'cotton', corn: 'maize', maize: 'maize', wheat: 'wheat', rice: 'rice', flax: 'flax', linen: 'flax',
};

function plantWord(u: Universe, s: string): { id: string; at: number } | null {
  let best: { id: string; at: number; len: number } | null = null;
  for (const [w, id] of Object.entries(PLANT_WORDS)) {
    const at = wordAt(s, w);
    if (at < 0 || !u.content.plants.has(id)) continue;
    if (!best || w.length > best.len) best = { id, at, len: w.length };
  }
  return best;
}

function intentPlants(c: ContentClause): boolean {
  const { s, cx, mods } = c;
  const { u, p } = cx;
  if (!p) return false;
  // a new plant: "grow a new plant called silverleaf", "invent a new crop called sunroot"
  const np = s.match(/\b(?:new |an? )(plant|crop|tree|fruit tree|bush|shrub|flower|herb|grass|grain|vine|vegetable|root|fruit)\b(?:,? (?:called|named|known as))? ([a-z][a-z-]*(?: [a-z][a-z-]*)?)/);
  if (np && /\b(grow|invent|create|make|plant|sow|conjure|bring|devise|give)\b/.test(s) && /\b(new|called|named)\b/.test(s)) {
    const name = np[2].replace(/\b(that|which|and|for|to|in|with|near|by|at|on)\b.*$/, '').trim();
    if (name && !u.content.plants.has(slug(name))) {
      const kind = np[1];
      const type = /crop|grain|vegetable|root/.test(kind) ? 'crop' : /tree|fruit/.test(kind) ? 'tree' : /grass|flower|herb/.test(kind) ? 'grass' : 'shrub';
      const id = slug(name);
      cx.made.add(id);
      const cmd: Command = { k: 'content.plant', name, type };
      const at = placeOf(c);
      if (at && type !== 'crop') cmd.pos = at;
      c.add(cmd, `a new ${type}: ${name}`);
      if (type === 'crop' && mods.place?.settlement !== undefined) c.add({ k: 'settlement.introduce', settlement: mods.place.settlement, crop: id }, `sown by them`);
      return true;
    }
  }
  // "introduce potatoes to Lune", "teach Aru to grow barley": a crop a people takes up
  const pw = plantWord(u, s);
  if (pw && u.content.plants.find(pw.id)?.type === 'crop' && mods.place?.settlement !== undefined && /\b(introduce|teach|bring|show|give .* seed|sow)\b/.test(s) && !/\b\d+\b/.test(s)) {
    c.add({ k: 'settlement.introduce', settlement: mods.place.settlement, crop: pw.id }, `introduce ${pw.id}`);
    return true;
  }
  // "grow a blueberry bush near Aru", "plant olive trees by the sea"
  if (pw && /\b(grow|plant|sow|seed|make|raise|create|put)\b/.test(s)) {
    const at = placeOf(c);
    const st = mods.place?.settlement !== undefined ? p.people.settlement(mods.place.settlement) : null;
    const pos = st ? besideTown(p, st as unknown as { pos: V3 }, st.id + 7) : at;
    c.add({ k: 'life.plant', species: pw.id, ...(pos ? { pos: norm(pos) } : {}) }, `plant ${u.content.plants.get(pw.id).name.toLowerCase()}`);
    return true;
  }
  return false;
}

// ───────────────────────────── real animals ─────────────────────────────

const SPAWN = /\b(summon|spawn|release|unleash|set loose|let loose|loose|send|bring|introduce|create|conjure|make|call forth|bring forth|breed|populate|fill)\b/;

/** a cell near pos where species sp can live (whales in the sea, crocodiles at the river) */
function homeFor(u: Universe, p: Planet, sp: number, pos: V3): V3 | null {
  const x = makeCtx(u, p);
  const c0 = p.cellAt(pos);
  if (habitatFit(x, sp, c0) > 0.15) return pos;
  let best = -1, bd = Infinity;
  for (let c = 0; c < p.count; c += 2) {
    if (habitatFit(x, sp, c) <= 0.15) continue;
    const d = distM(p, cellPos3(p, c), pos);
    if (d < bd) { bd = d; best = c; }
  }
  return best >= 0 ? cellPos3(p, best) : null;
}

function intentAnimals(c: ContentClause): boolean {
  const { s, cx, mods } = c;
  const { u, p } = cx;
  if (!p) return false;
  // (an animal named alone — "unicorns", "dragons!" — is asked for: a spawn of it)
  const bare = (): boolean => {
    const t = s.trim();
    if (!/^[a-z]+( [a-z]+)?$/.test(t)) return false;
    if (animalWord(u.content, t).kind === 'fantasy') return true;
    const id = slug(animalSingular(t));
    return u.content.animals.has(id) && u.content.animals.canonical(id) !== id;
  };
  const v = SPAWN.exec(s) ?? (bare() ? Object.assign(['spawn'], { index: 0, input: s }) as RegExpExecArray : null);
  if (!v) return false;
  let rest = (v.index === 0 && v[0] === 'spawn' && !s.startsWith('spawn') ? s : s.slice(v.index + v[0].length)).trim();
  // places left in the words ("in the desert" with no desert near, "on the savanna"): where that country is
  let country = '';
  const pm = rest.match(/\b(?:in|on|across|over|into|onto|through|to) (?:the )?([a-z]+)$/);
  if (pm && (u.content.biomes.has(pm[1]) || /^(north|south|east|west|hills|mountains|plains|jungle|woods|forest|sea|ocean|coast|desert)$/.test(pm[1]))) { country = pm[1]; rest = rest.slice(0, pm.index).trim(); }
  rest = rest.replace(/^(?:a herd of |a pack of |a flock of |a swarm of |a pride of |a school of |herds of |packs of |flocks of |herd of |pack of |flock of |a few |a pair of |lots of |a |an |the |some |many |\d+ )+/, '').trim();
  // "a plague of frogs": a swarm of them
  let plague = false;
  const pl = rest.match(/^(?:a )?(plague|swarm|horde|flood|rain|army|cloud) of ([a-z -]+)$/);
  if (pl) { plague = true; rest = pl[2].trim(); }
  rest = rest.replace(/\b(to|for|upon|unto|on|at|near|into|in|over|across|around|by|from|onto)\s*$/, '').trim();
  if (!rest || rest.split(' ').length > 3) return false;
  const w = animalWord(u.content, rest);
  // a word for nothing: refused only if it is one of the beings no real world has
  if (w.kind === 'none') {
    const L = u.content.lexicon as Record<string, unknown>;
    const none = new Set(((L.noSuchAnimals ?? []) as unknown[]).map(String));
    if (none.has(rest) || none.has(animalSingular(rest))) return c.ask(noSuchAnimal(rest));
    return false;
  }
  // a content animal the parser already reads ("send wolves", "give Aru chickens") is left to it, unless it was asked
  // for by an old name (ice beasts → musk oxen) or is one of the new real kinds it does not know the words of
  const direct = w.kind === 'base' && (u.content.animals.list[u.content.animals.idx(w.id)].id === slug(rest) || u.content.animals.list[u.content.animals.idx(w.id)].id === slug(animalSingular(rest)));
  const known = ['deer', 'boar', 'wolf', 'bear', 'bison', 'wild-goat', 'wild-sheep', 'aurochs', 'wild-horse', 'rabbit', 'fox', 'vulture', 'fish-shoal', 'whale', 'locust-swarm', 'desert-lizard', 'pig', 'dog', 'goat', 'sheep', 'cattle', 'horse', 'chicken'];
  if (w.kind === 'base' && direct && known.includes(w.id)) return false;
  if (w.kind === 'real') {
    const id = slug(w.name);
    cx.made.add(id);
    c.add({ k: 'content.animal', name: w.name, ...(plague ? { count: 60 } : mods.qty ? { count: Math.round(mods.qty) } : {}), ...(placeOf(c) ? { pos: placeOf(c)! } : {}) }, `${w.name}s`);
    // given to a people: theirs ("introduce cats to Aru")
    if (/\b(introduce|give|bring|gift|offer)\b/.test(v[0]) && mods.place?.settlement !== undefined) c.add({ k: 'settlement.introduce', settlement: mods.place.settlement, animal: id }, `${w.name}s for them`);
    return true;
  }
  const x = makeCtx(u, p);
  const sp = animalIdx(x, w.id);
  if (sp < 0) return false;
  // where: the country named, else the place, else the camera — moved to where the kind can live
  let at = placeOf(c);
  if (country) {
    const kind = country === 'jungle' ? 'rainforest' : country === 'woods' ? 'forest' : country === 'plains' ? 'grassland' : country === 'ocean' ? 'sea' : country;
    const from = at ?? [0, 0, 1] as V3;
    if (/^(north|south|east|west)$/.test(kind)) at = at ?? from;
    else at = kind === 'sea' ? nearestCountry(u, p, from, 'ground') : nearestCountry(u, p, from, kind) ?? at;
  }
  // a domestic kind given to a people goes into their pens ("bring camels to Aru"); set loose in the wild, its wild kind
  let def = u.content.animals.list[sp];
  if (def?.domestic && mods.place?.settlement !== undefined) {
    c.add({ k: 'settlement.introduce', settlement: mods.place.settlement, animal: def.id }, `${def.name.toLowerCase()} for them`);
    return true;
  }
  if (def?.domestic) def = u.content.animals.list.find((a) => a.domesticatesTo === def!.id) ?? def;
  const home = at ? homeFor(u, p, u.content.animals.idx(def.id), at) : null;
  const count = plague ? 60 : Math.round(mods.qty ?? (mods.one ? Math.max(1, def?.herd[0] ?? 1) : def?.herd[0] ?? 6));
  c.add({ k: 'life.spawn-animal', species: def.id, count: Math.max(1, count), ...(home ? { pos: norm(home) } : {}) },
    w.kind === 'fantasy' ? nearestReal(w.word, def) : `${def.name.toLowerCase()}`);
  return true;
}

// ───────────────────────────── the rest ─────────────────────────────

function intentPeopleAndRiders(c: ContentClause): boolean {
  const { s, cx } = c;
  if (/\bfour horsemen\b|\bhorsemen of the apocalypse\b|\bthe apocalypse riders?\b/.test(s)) {
    const at = placeOf(c);
    c.add({ k: 'disaster.spawn', kind: 'plague', ...(at ? { pos: at } : {}) }, 'pestilence');
    c.add({ k: 'disaster.spawn', kind: 'drought', ...(at ? { pos: at } : {}) }, 'famine');
    return true;
  }
  if (/\b(create|invent|make|design|breed|conjure)\b/.test(s) && /\bnew (?:species|kind|race|tribe|breed) of (?:people|humans?|men|folk|person|persons)\b|\bnew (?:people|race|tribe|humans?)\b(?! called)/.test(s) && !/\b(kingdom|city|town|village|settlement|nation|colony)\b/.test(s)) {
    void cx;
    return c.ask('A new people of the god\'s own making is not yet in its hands. Set down a people that lives ("add plains folk near Aru"): parted from their kin for generations, their children will become a people of their own after.');
  }
  return false;
}

/** every CONTENT intent, most specific first (god/freeform.ts runs this right after the RELATIONSHIP intents) */
export function intentContent(c: ContentClause): boolean {
  if (!c.cx.p) return false;
  if (has(c.s, 'prophet', 'sacred', 'holy', 'omen', 'sign')) return false;
  return intentPeopleAndRiders(c) || intentSeedOre(c) || intentMaterial(c) || intentPlants(c) || intentAnimals(c);
}
