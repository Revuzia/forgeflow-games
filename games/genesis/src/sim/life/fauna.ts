// GENESIS — LIVING CONTENT (LIVING.md §4.4): real animals only, and the content indices of old saves.
//
//   * Real animals. Four kinds that were not real were replaced IN PLACE by real ones (same index; the old id stays an
//     alias in animals.json: ice-beast → musk-ox, sand-crawler → caracal, haze-ray → golden-eagle, drift-ray → duck) and
//     the leviathan disaster became the rogue wave (disasters.json). A new animal the god names must be a real one:
//     the lexicon's `realAnimals` maps ~500 real species to the nearest base species (its body; and its size where it
//     differs). A fantasy noun maps to the nearest real kind (`fantasyAnimals`: dragon → crocodile, kraken → whale,
//     unicorn → wild horse, griffin → golden eagle, werewolf → wolf, yeti → bear …); a few are politely refused
//     (`noSuchAnimals`: zombies, ghosts, phoenixes, basilisks …).
//   * Saves. A save records each registry's id list (contentIds, sim.ts save); a save without one (1.4, and the 1.5
//     builds before this lane) is read with the frozen 1.4 lists (IDS_14). Indices that moved — the species born on a
//     world (index ≥ the content animals, shifted by the species appended), the god's and the mods' items, recipes,
//     plants and weather kinds — are remapped by id on load (contentAfterLoad), and herds of a replaced species on a
//     world outside the real species' temperature range are dropped without a chronicle line (no extinction notice).

import type { AnimalDef, Content, Registry } from '../content.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';

// ───────────────────────────── real animals ─────────────────────────────

/** what an animal word names: a real species (its base and size), a fantasy noun's nearest real kind, or nothing */
export type AnimalWord =
  | { kind: 'base'; id: string }
  | { kind: 'real'; name: string; base: string; size?: number }
  | { kind: 'fantasy'; word: string; id: string }
  | { kind: 'none'; word: string };

const lexCache = new WeakMap<Content, { real: Map<string, [string, number | undefined]>; fantasy: Map<string, string>; none: Set<string> }>();

function lex(c: Content) {
  let l = lexCache.get(c);
  if (l) return l;
  const L = c.lexicon as Record<string, unknown>;
  const real = new Map<string, [string, number | undefined]>();
  const ra = (L.realAnimals ?? {}) as Record<string, string | [string, number]>;
  for (const [w, v] of Object.entries(ra)) real.set(w, Array.isArray(v) ? [String(v[0]), Number(v[1])] : [String(v), undefined]);
  const fantasy = new Map<string, string>(Object.entries((L.fantasyAnimals ?? {}) as Record<string, string>));
  const none = new Set<string>(((L.noSuchAnimals ?? []) as unknown[]).map(String));
  l = { real, fantasy, none };
  lexCache.set(c, l);
  return l;
}

/** english singular of an animal word ("wolves" → "wolf", "oxen" → "ox", "geese" → "goose", "mice" → "mouse") */
export function animalSingular(w: string): string {
  const s = w.trim().toLowerCase();
  const irregular: Record<string, string> = { wolves: 'wolf', oxen: 'ox', geese: 'goose', mice: 'mouse', lice: 'louse', teeth: 'tooth', feet: 'foot', calves: 'calf', halves: 'half', elves: 'elf', dwarves: 'dwarf', 'musk oxen': 'musk ox', muskoxen: 'muskox', fish: 'fish', deer: 'deer', sheep: 'sheep', moose: 'moose', bison: 'bison', buffalo: 'buffalo', shellfish: 'shellfish', octopi: 'octopus', cacti: 'cactus', hippopotami: 'hippopotamus', rhinoceroses: 'rhinoceros', yak: 'yak', grouse: 'grouse', quail: 'quail', salmon: 'salmon', trout: 'trout', cod: 'cod', squid: 'squid', krill: 'krill', swine: 'swine', aurochs: 'aurochs' };
  if (irregular[s]) return irregular[s];
  const words = s.split(' ');
  const last = words[words.length - 1];
  const head = words.slice(0, -1).join(' ');
  const join = (x: string) => (head ? `${head} ${x}` : x);
  if (irregular[last]) return join(irregular[last]);
  if (/ies$/.test(last) && last.length > 4) return join(last.replace(/ies$/, 'y'));
  if (/(ches|shes|sses|xes|zes)$/.test(last)) return join(last.slice(0, -2));
  if (/ves$/.test(last)) return join(last.replace(/ves$/, 'f'));
  if (/s$/.test(last) && !/(ss|us|is)$/.test(last)) return join(last.slice(0, -1));
  return s;
}

/** words of an animal's name that do not say which animal it is ('wild horse', 'golden eagle', 'harbour seal') */
const GENERIC = new Set(['wild', 'golden', 'harbour', 'harbor', 'red', 'honey', 'kept', 'desert', 'grey', 'gray', 'common', 'great', 'black', 'white', 'brown', 'snow', 'sea', 'mountain', 'giant', 'little', 'lesser', 'greater', 'musk']);

/** words that make a real animal a creature of myth ("winged horse", "fire lizard", "two-headed dog") — no real world has them */
// (only words no real animal's common name is built on, or whose real compounds the lexicon lists: vampire bat, ghost crab)
const MYTHIC = new Set(['winged', 'flying', 'fire', 'flame', 'flaming', 'fiery', 'fire-breathing', 'dire', 'hell', 'hellish', 'demon', 'demonic',
  'ghost', 'ghostly', 'shadow', 'spectral', 'phantom', 'undead', 'vampire', 'vampiric', 'two-headed', 'three-headed', 'many-headed',
  'headed', 'headless', 'horned', 'magic', 'magical', 'enchanted', 'immortal', 'talking', 'invisible', 'celestial', 'unholy',
  'lava', 'mechanical', 'robot', 'robotic', 'cyborg', 'mutant', 'radioactive', 'laser', 'alien']);
/** size words that do not change which animal it is ("giant wolves" are wolves, at a wolf's size) */
const SIZE_WORDS = new Set(['giant', 'huge', 'enormous', 'gigantic', 'colossal', 'massive', 'monstrous', 'mega', 'big', 'large', 'great', 'tiny', 'small', 'little']);

/** is word w (singular) the base animal a under another name: its head word is one of a's own name words */
function sameKind(w: string, a: AnimalDef): boolean {
  const head = animalSingular(w.split(' ').pop() ?? w);
  const own = new Set([...a.id.split('-'), ...a.name.toLowerCase().split(' ')].filter((t) => !GENERIC.has(t)).map((t) => animalSingular(t)));
  return own.has(head);
}

/**
 * What a word for an animal names in this world: a content animal (its id or an old alias), a real species the lexicon
 * knows (made on the world as a species of its own with that base's body), a fantasy noun's nearest real kind, or
 * nothing (refused, or not a known animal at all).
 */
export function animalWord(c: Content, word: string): AnimalWord {
  const raw = String(word).trim().toLowerCase().replace(/^(a|an|the|some)\s+/, '');
  const L = lex(c);
  for (const w of [raw, animalSingular(raw)]) {
    const slugged = w.replace(/[^a-z0-9]+/g, '-');
    if (c.animals.has(slugged)) return { kind: 'base', id: c.animals.canonical(slugged) };
    const r = L.real.get(w);
    if (r) {
      // the same animal under another name (a bee is the honey bees, an eagle the golden eagle, a seal the harbour seal):
      // the word's head is a word of the base's own name; otherwise a species of its own with the base's body
      if (c.animals.has(r[0]) && (slugged === r[0] || c.animals.find(r[0])!.name.toLowerCase() === w || sameKind(w, c.animals.find(r[0])!))) return { kind: 'base', id: c.animals.canonical(r[0]) };
      if (c.animals.has(r[0])) return { kind: 'real', name: w, base: c.animals.canonical(r[0]), size: r[1] };
    }
    const f = L.fantasy.get(w);
    if (f && c.animals.has(f)) return { kind: 'fantasy', word: w, id: c.animals.canonical(f) };
    if (L.none.has(w)) return { kind: 'none', word: w };
  }
  // the last word of a longer name ("spotted owl", "snow dragon"; the real compounds with a mythic-sounding word —
  // flying squirrel, fire ant, horned owl, giant tortoise — are in the lexicon's realAnimals and were found above)
  const words = raw.split(' ');
  if (words.length > 1) {
    const tail = animalWord(c, words[words.length - 1]);
    if (tail.kind === 'real' || tail.kind === 'base') {
      const base = tail.kind === 'real' ? tail.base : tail.id;
      const mods = words.slice(0, -1);
      // a mythic word on a real animal ("flying horse", "winged lion", "fire lizard"): no such thing; its nearest real kind
      if (mods.some((m) => MYTHIC.has(m))) return { kind: 'fantasy', word: raw, id: base };
      // a size word only ("giant wolf", "huge bears"): the real animal at its real size
      if (mods.every((m) => SIZE_WORDS.has(m))) return tail;
      return { kind: 'real', name: animalSingular(raw), base, size: tail.kind === 'real' ? tail.size : undefined };
    }
    if (tail.kind === 'fantasy') return { kind: 'fantasy', word: raw, id: tail.id };
    if (tail.kind === 'none') return { kind: 'none', word: raw };
  }
  return { kind: 'none', word: raw };
}

/** the polite refusal for an animal that is not real */
export function noSuchAnimal(word: string): string {
  return `Nothing like that lives in this world${word ? ` (${word})` : ''}: it is a real world, and only real animals walk in it. Name a real one — zebras, otters, elephants, eagles.`;
}

/** the words for a fantasy noun given its nearest real kind */
export function nearestReal(word: string, a: AnimalDef): string {
  return `There are no ${animalPlural(word)} in a real world; the nearest real thing is the ${a.name.toLowerCase()}.`;
}

/** english plural of an animal word ("wolf" → "wolves", "werewolf" → "werewolves", "wild horse" → "wild horses", "ox" → "oxen") */
export function animalPlural(word: string): string {
  const one = animalSingular(word);
  const words = one.split(' ');
  const last = words.pop() ?? one;
  const IRREG: Record<string, string> = { ox: 'oxen', mouse: 'mice', goose: 'geese', louse: 'lice', sheep: 'sheep', deer: 'deer', fish: 'fish', moose: 'moose', bison: 'bison', cattle: 'cattle', 'fish-shoal': 'fish' };
  // (wolf → wolves, calf → calves, elf → elves, dwarf → dwarves; knife-like "fe" → "ves")
  const lastMany = IRREG[last] ?? (/(lf|rf|af)$/.test(last) ? `${last.slice(0, -1)}ves` : /fe$/.test(last) ? `${last.slice(0, -2)}ves` : /(s|x|ch|sh)$/.test(last) ? `${last}es` : /[^aeiou]y$/.test(last) ? `${last.slice(0, -1)}ies` : `${last}s`);
  return [...words, lastMany].join(' ');
}

// ───────────────────────────── content ids in saves ─────────────────────────────

export type RegistryName = 'animals' | 'items' | 'recipes' | 'plants' | 'weather' | 'ores' | 'materials' | 'buildings';
export const ID_REGISTRIES: RegistryName[] = ['animals', 'items', 'recipes', 'plants', 'weather', 'ores', 'materials', 'buildings'];
export type ContentIds = Partial<Record<RegistryName, string[]>>;

/**
 * The 1.4 base lists (frozen): the animals by id (four of them since replaced in place), and the length of every other
 * registry's base list — the base content only ever appends, so the 1.4 entries are the first ones of today's.
 */
export const IDS_14 = {
  animals: ['deer', 'boar', 'wolf', 'bear', 'bison', 'wild-goat', 'wild-sheep', 'aurochs', 'wild-horse', 'rabbit', 'fox', 'vulture', 'fish-shoal', 'whale',
    'locust-swarm', 'ice-beast', 'desert-lizard', 'sand-crawler', 'haze-ray', 'pig', 'dog', 'goat', 'sheep', 'cattle', 'horse', 'chicken', 'drift-ray'],
  counts: { items: 129, recipes: 152, plants: 30, weather: 20, ores: 16, materials: 16, buildings: 41 } as Record<Exclude<RegistryName, 'animals'>, number>,
};

/** each registry's id list (the save header's contentIds) */
export function contentIdsOf(c: Content): ContentIds {
  const out: ContentIds = {};
  for (const k of ID_REGISTRIES) out[k] = (c[k] as Registry<{ id: string }>).ids();
  return out;
}

/** the id lists a save without contentIds was made with: the 1.4 base, then its packs' and the god's ids, in order */
function idsOf14(u: Universe, minor: number): ContentIds {
  const out: ContentIds = {};
  const base = u.content.sources[0];
  for (const k of ID_REGISTRIES) {
    const list: string[] = [];
    const seen = new Set<string>();
    const put = (id: string) => { if (!seen.has(id)) { seen.add(id); list.push(id); } };
    if (k === 'animals') for (const id of IDS_14.animals) put(id);
    else {
      // (the 1.5 builds before this lane already had the rainbow: RELATIONSHIP appended it)
      const n = IDS_14.counts[k] + (k === 'weather' && minor >= 5 ? 1 : 0);
      for (const e of ((base?.[k] ?? []) as { id: string }[]).slice(0, n)) put(e.id);
    }
    for (const pk of u.content.sources.slice(1)) for (const e of (pk[k] ?? []) as { id: string }[]) if (e && typeof e.id === 'string') put(e.id);
    out[k] = list;
  }
  return out;
}

/** old index → new index for one registry (null: nothing moved) */
function remapOf(old: string[], reg: Registry<{ id: string }>): Int32Array | null {
  const m = new Int32Array(old.length);
  let moved = false;
  for (let i = 0; i < old.length; i++) {
    const j = reg.idx(old[i]);
    m[i] = j;
    if (j !== i) moved = true;
  }
  return moved ? m : null;
}

const mapIdx = (m: Int32Array | null, i: number) => (m && i >= 0 && i < m.length ? m[i] : i);

function mapKeys<T>(m: Int32Array | null, o: Record<string, T> | undefined): Record<string, T> | undefined {
  if (!m || !o) return o;
  const out: Record<string, T> = {};
  for (const k of Object.keys(o)) {
    const n = Number(k);
    out[Number.isInteger(n) && String(n) === k ? String(mapIdx(m, n)) : k] = o[k];
  }
  return out;
}

/**
 * After a save is loaded (sim.ts universeFromHeader, a save file only — the rewind ring's keyframes are this build's):
 * remap every index that moved since the save was made, and drop the herds of a replaced species that cannot live where
 * they stood. Returns what was done (tests, the inspector).
 */
export function contentAfterLoad(u: Universe, h: Record<string, unknown>): { remapped: string[]; dropped: number } {
  const saved = h.contentIds as ContentIds | undefined;
  const fromVer = typeof h.migratedFrom === 'string' ? Number(String(h.migratedFrom).split('.')[1] ?? 5) : 5;
  const old = saved && typeof saved === 'object' ? saved : idsOf14(u, fromVer);
  const c = u.content;
  const maps: Partial<Record<RegistryName, Int32Array | null>> = {};
  const remapped: string[] = [];
  for (const k of ID_REGISTRIES) {
    const list = old[k];
    if (!Array.isArray(list)) continue;
    const m = remapOf(list, c[k] as Registry<{ id: string }>);
    maps[k] = m;
    if (m) remapped.push(k);
  }
  // the species born on a world come after the content animals: they move by the number appended
  const oldAnimals = Array.isArray(old.animals) ? old.animals.length : c.animals.size;
  const shift = c.animals.size - oldAnimals;
  const am = maps.animals ?? null;
  const sp = (i: number) => (i < 0 ? i : i < oldAnimals ? mapIdx(am, i) : i + shift);
  if (shift) remapped.push('species');
  if (remapped.length) for (const p of u.planets) remapPlanet(u, p, maps, sp);
  // sacred animals are kept by id ('animal:<id>'): an old id becomes the real kind that replaced it
  for (const p of u.planets) for (const st of p.people.settlements) {
    st.culture.sacred = st.culture.sacred.map((t) => {
      if (!t.startsWith('animal:')) return t;
      const id = t.slice(7);
      const k = c.animals.has(id) ? c.animals.canonical(id) : id;
      return k !== id ? `animal:${k}` : t;
    });
  }
  // disasters under way are kept by kind id: an old id becomes the kind that replaced it (a 1.4 leviathan at sea goes on
  // as the rogue wave — its view, chronicle and events name the real kind; integration, 2026-10-14)
  for (const d of u.god.disasters) if (c.disasters.has(d.kind)) d.kind = c.disasters.canonical(d.kind);
  // herds of a kind replaced in place by a real one, where the real one cannot live (a methane sky's 'haze rays')
  let dropped = 0;
  if (Array.isArray(old.animals)) {
    const replaced = new Set<number>();
    for (let i = 0; i < Math.min(old.animals.length, c.animals.size); i++) {
      const a = c.animals.list[i];
      if (a.id !== old.animals[i] && (a.aliases ?? []).includes(old.animals[i])) replaced.add(i);
    }
    if (replaced.size) for (const p of u.planets) dropped += dropMisplaced(p, c, replaced);
  }
  return { remapped, dropped };
}

function remapPlanet(u: Universe, p: Planet, maps: Partial<Record<RegistryName, Int32Array | null>>, sp: (i: number) => number): void {
  const ps = p.people;
  const im = maps.items ?? null, rm = maps.recipes ?? null, pm = maps.plants ?? null, wm = maps.weather ?? null, mm = maps.materials ?? null, bm = maps.buildings ?? null;
  // ── animals: herds, the species born here, the books of the ecology, memories of hunts
  for (const h of ps.herds) h.species = sp(h.species);
  for (const d of ps.species) { d.idx = sp(d.idx); d.parent = sp(d.parent); d.base = sp(d.base); }
  const eco = ps.eco;
  const spKeys = <T>(o: Record<string, T> | undefined): Record<string, T> | undefined => {
    if (!o) return o;
    const out: Record<string, T> = {};
    for (const k of Object.keys(o)) out[/^\d+$/.test(k) ? String(sp(Number(k))) : k] = o[k];
    return out;
  };
  eco.seen = spKeys(eco.seen)!; eco.extinct = spKeys(eco.extinct)!; eco.peak = spKeys(eco.peak)!;
  if (eco.became) { const b = spKeys(eco.became)!; for (const k of Object.keys(b)) b[k] = sp(b[k]); eco.became = b; }
  const A = ps.agents;
  const MEM = A.memKind.length / Math.max(1, A.cap);
  // memories that name a species (a hunt, a great hunt: people/defs.ts MEMK hunted 24, huntFeat 39) or a recipe (learned
  // 2, taught 3, discovered 4)
  for (let i = 0; i < A.hi * MEM; i++) {
    const k = A.memKind[i];
    if (k === 24 || k === 39) A.memA[i] = sp(A.memA[i]);
    else if (rm && (k === 2 || k === 3 || k === 4)) A.memA[i] = mapIdx(rm, A.memA[i]);
  }
  // ── items: what agents carry and use, what lies on the ground, the stores, what missions carry
  if (im) {
    for (let i = 0; i < A.hi * (A.invItem.length / Math.max(1, A.cap)); i++) if (A.invItem[i] >= 0) A.invItem[i] = mapIdx(im, A.invItem[i]);
    for (let s = 0; s < A.hi; s++) {
      if (A.tool[s] >= 0) A.tool[s] = mapIdx(im, A.tool[s]);
      if (A.gear[s] >= 0) A.gear[s] = mapIdx(im, A.gear[s]);
      if (A.boat[s] >= 0) A.boat[s] = mapIdx(im, A.boat[s]);
      const tt = A.tripTask[s];
      if (tt > 255) A.tripTask[s] = (tt & 255) | ((mapIdx(im, (tt >> 8) - 1) + 1) << 8);
    }
    for (const g of ps.items) g.item = mapIdx(im, g.item);
    for (const m of ps.missions) {
      if (m.boat >= 0) m.boat = mapIdx(im, m.boat);
      for (const q of m.out) q[0] = mapIdx(im, q[0]);
      for (const q of m.back) q[0] = mapIdx(im, q[0]);
    }
  }
  // ── recipes: what every head knows
  if (rm) {
    const kw = A.kw;
    const old = A.know.slice();
    A.know.fill(0);
    for (let s = 0; s < A.hi; s++) {
      for (let w = 0; w < kw; w++) {
        let bits = old[s * kw + w];
        while (bits) {
          const b = 31 - Math.clz32(bits);
          bits &= ~(1 << b);
          const k = mapIdx(rm, w * 32 + b);
          if (k >= 0 && k < kw * 32) A.know[s * kw + (k >> 5)] |= 1 << (k & 31);
        }
      }
    }
  }
  for (const b of ps.buildings) {
    if (rm) b.books = b.books.map((k) => mapIdx(rm, k));
    if (mm) b.material = mapIdx(mm, b.material);
    if (bm) b.type = mapIdx(bm, b.type);
  }
  for (const st of ps.settlements) {
    if (im) {
      const store: number[] = [];
      st.store.forEach((q, i) => { if (q) { const j = mapIdx(im, i); while (store.length <= j) store.push(0); store[j] = (store[j] ?? 0) + q; } });
      st.store = store;
      st.wants = st.wants.map((i) => mapIdx(im, i));
      if (st.res) st.res.items = mapKeys(im, st.res.items)!;
    }
    if (rm) {
      st.library = st.library.map((k) => mapIdx(rm, k)).sort((a, b) => a - b);
      st.written = st.written.map((k) => mapIdx(rm, k)).sort((a, b) => a - b);
      st.secrets = st.secrets.map((k) => mapIdx(rm, k)).sort((a, b) => a - b);
      st.culture.taboos = st.culture.taboos.map((k) => mapIdx(rm, k));
      st.culture.tabooSince = mapKeys(rm, st.culture.tabooSince);
      st.jobs = st.jobs.map((j) => ({ ...j, k: mapIdx(rm, j.k) }));
      if (st.places) st.places = { hour: st.places.hour, at: mapKeys(rm, st.places.at)! };
    }
    if (pm) {
      if (st.crop >= 0) st.crop = mapIdx(pm, st.crop);
      for (const fs of st.land?.fields ?? []) if (fs.sp >= 0) fs.sp = mapIdx(pm, fs.sp);
    }
  }
  // ── plants: the dominant species of every cell
  if (pm) {
    const f = p.f;
    for (const arr of [f.grassSpecies, f.shrubSpecies, f.treeSpecies, f.cropSpecies]) for (let c = 0; c < arr.length; c++) if (arr[c] >= 0) arr[c] = mapIdx(pm, arr[c]);
    for (const k of ['grassSpecies', 'shrubSpecies', 'treeSpecies', 'cropSpecies'] as const) p.bump(k);
  }
  // ── weather kinds of the systems in the sky; ore kinds in the ground
  if (wm) for (const w of p.weather) w.kind = mapIdx(wm, w.kind);
  const om = maps.ores ?? null;
  if (om) { const o = p.f.oreType; for (let c = 0; c < o.length; c++) if (o[c] > 0) o[c] = mapIdx(om, o[c] - 1) + 1; p.bump('oreType'); }
  void u;
}

/** herds of a replaced kind where the real kind cannot live (the temperature of the place): gone, and so is the record
 * that the kind ever lived on that world (no extinction notice follows) */
function dropMisplaced(p: Planet, c: Content, replaced: Set<number>): number {
  const ps = p.people;
  const before = ps.herds.length;
  ps.herds = ps.herds.filter((h) => {
    if (!replaced.has(h.species)) return true;
    const a = c.animals.list[h.species];
    const t = p.s.tempMean[h.cell] || p.f.temperature[h.cell];
    return t > a.temp[0] && t < a.temp[3];
  });
  const n = before - ps.herds.length;
  if (n) {
    for (const sp of replaced) {
      if (ps.herds.some((h) => h.species === sp)) continue;
      const k = String(sp);
      delete ps.eco.seen[k]; delete ps.eco.peak[k]; delete ps.eco.extinct[k];
    }
    ps.hIndex.clear();
    ps.herds.forEach((h, i) => ps.hIndex.set(h.id, i));
    ps.version++;
  }
  return n;
}
