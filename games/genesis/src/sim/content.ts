// GENESIS — content loading (CONTRACT.md §9): base pack + mod packs -> validated, indexed registries.
//
// Content is data. A pack is a JSON object with optional sections (plants, weather, biomes, biomeRules, stars,
// planetkinds, ores, scenarios, species, items, recipes, buildings, materials, animals, diseases, phonologies, events;
// later: powers, lexicon, creatures, disasters). Packs are merged in order: an
// entry whose id already exists REPLACES that entry in place (so indices stay stable and a mod can rebalance oak), a new
// id is appended. References between sections are checked after the merge and every problem is reported at once, in
// words a modder can act on ("plants › 'oakk' … did you mean 'oak'?").
//
// Registries map string id -> dense index (content order). Field arrays store these indices (treeSpecies, biome,
// oreType - 1, ...), and the renderer imports the same base pack, so indices agree across the worker boundary.

// ───────────────────────────── definitions ─────────────────────────────

export type PlantType = 'grass' | 'shrub' | 'tree' | 'crop';
export const PLANT_TYPES: readonly PlantType[] = ['grass', 'shrub', 'tree', 'crop'];

export interface PlantDef {
  id: string;
  name: string;
  type: PlantType;
  form: string;
  habitat: 'land' | 'shore' | 'water';
  /** [min, optLo, optHi, max] °C against the slow mean temperature */
  temp: [number, number, number, number];
  /** [min, optLo, optHi, max] soil moisture 0..1 */
  moisture: [number, number, number, number];
  soil: number;
  salinity: number;
  water: [number, number];
  growth: number;
  spread: number;
  light: number;
  height: [number, number];
  fuel: number;
  flammability: number;
  deciduous?: boolean;
  edible?: boolean;
  domestic?: boolean;
  domesticatesTo?: string;
  colors: { leaf: string; leafAutumn?: string; dry?: string; bark?: string; flower?: string };
}

export const PRECIP_TYPES = ['none', 'rain', 'snow', 'hail', 'ash', 'acid', 'blood', 'sand'] as const;
export type PrecipTypeName = (typeof PRECIP_TYPES)[number];

export interface WeatherSpawn {
  rate: number;
  needsAir?: boolean;
  humidity?: [number, number];
  temp?: [number, number];
  latitude?: [number, number];
  ocean?: boolean;
  sand?: number;
  lava?: number;
  toxicity?: number;
  magnetism?: number;
  calm?: boolean;
}

export interface WeatherDef {
  id: string;
  name: string;
  precipType: PrecipTypeName;
  precip: number;
  cloud: number;
  fog: number;
  wind: number;
  spin: number;
  lightning: number;
  tempDelta: number;
  humidityDelta: number;
  radius: [number, number];
  life: [number, number];
  speed: number;
  spawn: WeatherSpawn | null;
  deposit?: { snow?: number; ash?: number; sand?: number };
  effects?: Record<string, number>;
  render: Record<string, unknown>;
}

export type BiomeCond = [string, '<' | '<=' | '>' | '>=' | '==' | '!=', number];

export interface BiomeDef {
  id: string;
  name: string;
  color: string;
  paint: {
    grass?: number; shrub?: number; tree?: number; crop?: number; soil?: number; sand?: number; snow?: number;
    ice?: number; ash?: number; moisture?: number; water?: number;
    species?: { grass?: string; shrub?: string; tree?: string; crop?: string };
  };
}

export interface BiomeRule {
  biome: string;
  all?: BiomeCond[];
  any?: BiomeCond[];
}

export interface StarDef {
  id: string;
  name: string;
  kind: string;
  luminosity: number;
  temperature: number;
  radius: number;
  activity: number;
  color?: [number, number, number];
}

export interface OreDef {
  id: string;
  name: string;
  color: string;
  rarity: number;
  geology: Record<string, number>;
}

export interface ReliefDef {
  base: number; continents: number; continentScale: number; ridges: number; ridgeScale: number; hills: number;
  craters: number; craterMax: number; maria: number; highlands: number; volcanoes: number; mesas: number;
  canyons: number; dunes: number; carve: number;
}

export interface PlanetKindDef {
  id: string;
  name: string;
  render: string;
  radius: number;
  n: number;
  gravity: number;
  dayHours: number;
  axialTilt: number;
  magnetism: number;
  atmosphere: {
    pressure: number; o2: number; co2: number; n2: number; methane: number; dust: number; toxicity: number;
    tint: [number, number, number] | null;
  };
  climateOffset: number;
  oceanFraction: number;
  liquid: { id: string; freeze: number; boil: number };
  cloudiness: number;
  vegetation: number;
  /** how wet the land starts (1 = Earth-like) */
  moisture?: number;
  relief: ReliefDef;
  surface: { regolith: number; soil: number; sand: number; snowLine: number | null; iceCaps: number; ash: number };
}

export interface OrbitDef {
  a: number;
  e?: number;
  inc?: number;
  node?: number;
  phase0?: number;
  yearDays?: number;
  periodDays?: number;
}

export interface ScenarioPlanetDef {
  name: string;
  kind: string;
  overrides?: Record<string, unknown>;
  orbit: OrbitDef;
  moons?: ScenarioPlanetDef[];
}

export interface ScenarioDef {
  id: string;
  name: string;
  description?: string;
  star: string;
  starName?: string;
  focus?: number;
  startHour?: number;
  planets: ScenarioPlanetDef[];
  peoples: unknown[];
}

// ───────────────────────────── peoples (phase 2) ─────────────────────────────

/** eras in order (recipes carry one; a settlement's era is the furthest it really works in) */
export const ERAS = ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'] as const;
export type Era = (typeof ERAS)[number];

/** skill groups (per-agent skill levels 0..1; masters are >= 0.7) */
export const SKILLS = ['gather', 'hunt', 'fish', 'farm', 'herd', 'craft', 'smith', 'build', 'cook', 'heal', 'lore', 'sail', 'fight'] as const;
export type SkillName = (typeof SKILLS)[number];

/** needs (CONTRACT §8.2): the shared nine + species-specific ones */
export const NEEDS = ['food', 'water', 'warmth', 'rest', 'safety', 'belonging', 'status', 'curiosity', 'faith', 'wetness', 'methane', 'hive'] as const;
export type NeedName = (typeof NEEDS)[number];

export const TRAITS = ['curiosity', 'boldness', 'sociability', 'piety', 'aggression', 'diligence'] as const;
export type TraitName = (typeof TRAITS)[number];

export const BODY_PLANS = ['biped', 'quadruped', 'hexapod-hive', 'aquatic', 'flyer', 'serpent', 'blob'];
export const FORAGE_SOURCES = ['vegetation', 'sea', 'air'];

/** place contexts sensed from the world around a cell (resources, terrain, climate) — see people/context.ts */
export const ENV_CONTEXTS = [
  'water', 'fresh-water', 'sea', 'river', 'shore', 'forest', 'wood', 'grass', 'wild-grain', 'berries', 'reeds', 'fertile',
  'field', 'dune', 'sand', 'snow', 'ice', 'cold', 'hot', 'mountain', 'volcanic', 'herds', 'predators', 'fish', 'methane',
  'flint', 'clay', 'copper', 'tin', 'iron', 'coal', 'gold', 'silver', 'sulfur', 'obsidian', 'saltpeter', 'salt', 'glass-sand',
  'oil', 'uranium', 'gems', 'fire', 'store', 'sacred',
] as const;

/** accident / event triggers: things that HAPPEN at a place (lightning in a dune, fire on clay, a death...) */
export const EVENT_TRIGGERS = [
  'lightning', 'lightning-dune', 'lightning-fire', 'wildfire', 'fire-on-clay', 'rotten-grain', 'meteor-iron', 'copper-in-fire',
  'spilled-seed', 'wolf-cubs', 'tame-young', 'flood', 'drought', 'death', 'plague', 'injury', 'eclipse', 'comet', 'miracle',
  'trade', 'raid', 'war', 'famine', 'feast', 'tar-seep', 'firework', 'flint-sparks', 'storm-at-sea', 'birth',
  // societies & ecology (phase 2b)
  'blight', 'battle', 'conquest', 'contact', 'siege', 'schism',
  // the god layer (phase 3): miracles and disasters are introductions too (CONTRACT §11.2)
  'miracle-forest', 'miracle-heal', 'fireball', 'quake', 'eruption', 'tsunami', 'impact', 'storm', 'swarm', 'eclipse-long',
  'flare', 'refugees', 'rebuild', 'god-hand',
] as const;

export interface SpeciesDef {
  id: string;
  name: string;
  plural: string;
  adjective: string;
  desc?: string;
  body: string;
  /** adult height, m */
  size: number;
  mass?: number;
  /** × base walk (0.25 m/tick) */
  speed: number;
  /** × speed in water (0 = cannot swim) */
  swim: number;
  fly?: boolean;
  /** hover altitude for flyers, m */
  alt?: number;
  lifespan: number;
  maturity: number;
  elder: number;
  fertility: number;
  /** food tag -> preference weight */
  diet: Record<string, number>;
  forage: string[];
  temp: [number, number, number, number];
  breathes: 'o2' | 'methane' | 'none';
  habitat: string[];
  nocturnal: boolean;
  hive: null | { castes: string[]; shares: number[]; queen: string; sharedMemory: boolean; queenLifespan?: number };
  needs: Partial<Record<NeedName, number>>;
  decay?: Partial<Record<NeedName, number>>;
  traits: Record<TraitName, number>;
  colors: { skin: string[]; hair: string[]; cloth: string[]; caste?: Record<string, string> };
  phonology: string;
  style: { materials: string[]; form: string; roof: string; palette: string[] };
  taboos: string[];
  sacred: string[];
  god: { awe: number; fear: number };
  start: string[];
}

export interface ItemDef {
  id: string;
  name: string;
  tags: string[];
  weight: number;
  /** days of food for an adult per unit */
  food?: number;
  fuel?: number;
  value: number;
  /** building material this item stands for (render hint) */
  material?: string;
  /** fraction lost per day in a store */
  decay?: number;
  /** cold protection when worn 0..1 */
  warmth?: number;
  /** tool / weapon quality */
  quality?: number;
}

export interface RecipeIO {
  item?: string;
  tag?: string;
  qty: number;
}

export interface RecipeOut {
  item?: string;
  building?: string;
  knowledge?: string;
  qty?: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  kind: 'craft' | 'gather' | 'idea' | 'build';
  desc?: string;
  inputs: RecipeIO[];
  tools: string[];
  place: { needs?: string[] | string; heat?: number; near?: string[]; biome?: string[] };
  knowledge: string[];
  outputs: RecipeOut[];
  time: number;
  skill: SkillName;
  difficulty?: number;
  discover: { base: number; triggers: string[]; curiosity: number };
  teach: number;
  era: Era;
  writes?: boolean;
  enables?: string[];
  effect?: Record<string, number>;
  gather?: { task: string; items: string[] };
  species?: string[];
  secret?: number;
}

export interface BuildingDef {
  id: string;
  name: string;
  function: string;
  provides: string[];
  footprint: number;
  capacity: number;
  storage: number;
  materials: string[];
  recipe: string;
  cost: number;
  work: number;
  hp: number;
  decay: number;
  heat: number;
  light: number;
  height?: number;
  era: Era;
  species?: string[];
}

export interface MaterialDef {
  id: string;
  name: string;
  items: RecipeIO[];
  knowledge: string | null;
  color: string;
  roughness: number;
  pattern?: string;
  flammability: number;
  strength: number;
  insulation: number;
  era: Era;
}

export interface AnimalDef {
  id: string;
  name: string;
  kind: 'herbivore' | 'predator' | 'scavenger' | 'fish' | 'bird' | 'insect' | 'domestic';
  body: string;
  size: number;
  mass?: number;
  speed: number;
  herd: [number, number];
  diet: string[];
  temp: [number, number, number, number];
  habitat: 'land' | 'water' | 'sea' | 'air';
  biomes: string[];
  products: RecipeIO[];
  danger: number;
  flee: number;
  domesticable: boolean;
  domesticatesTo?: string;
  domestic?: boolean;
  breed: number;
  swarm?: boolean;
  nocturnal?: boolean;
  colors: string[];
}

export interface DiseaseDef {
  id: string;
  name: string;
  transmission: 'contact' | 'water' | 'air' | 'food' | 'animal';
  contagion: number;
  mortality: number;
  duration: number;
  /** days exposed (infected, not yet sick or infectious); default 1 */
  incubation?: number;
  immunity: number;
  medicine: string;
  species: string[] | null;
  origin: string[];
  crowd: number;
}

export interface PhonologyDef {
  id: string;
  onsets: string[];
  vowels: string[];
  codas: string[];
  syllables: [number, number];
  personal: [number, number];
  sep: string;
  features: Record<string, string>;
}

export interface EventTemplateDef {
  id: string;
  kind: string;
  weight: number;
  text: string[];
}

// ───────────────────────────── the god layer (phase 3) ─────────────────────────────

/** radial / palette categories of powers (CONTRACT §16.3) */
export const POWER_CATEGORIES = ['Shape', 'Water', 'Sky', 'Life', 'Peoples', 'Ideas', 'Fire', 'Disasters', 'Hand', 'Creature', 'Worlds', 'Time', 'Laws'] as const;
/** how a power picks where / what it acts on */
export const POWER_TARGETS = ['point', 'region', 'line', 'entity', 'settlement', 'agent', 'planet', 'none'] as const;
export const PARAM_TYPES = ['number', 'int', 'string', 'boolean', 'enum', 'pos', 'entity', 'vec3', 'items', 'any'] as const;

/** one parameter of a power as the palette / radial UI shows it (types, ranges, units, what it targets) */
export interface PowerParamDef {
  type: (typeof PARAM_TYPES)[number];
  min?: number;
  max?: number;
  default?: unknown;
  unit?: string;
  /** enum choices: a static list, or the name of a content registry ('weather', 'plants', 'animals', 'items', ...) */
  values?: string[] | string;
  /** a point, a region (pos + radius), a line (pos + to) or an entity (agent, settlement, disaster ...) */
  target?: 'point' | 'region' | 'line' | 'entity';
  /** entity kinds a target accepts */
  entity?: string[];
  desc?: string;
}

export interface PowerDef {
  id: string;
  name: string;
  category: (typeof POWER_CATEGORIES)[number];
  /** icon key (the UI draws it from its own icon set) */
  icon: string;
  /** radial ring: 0 inner (the everyday powers) .. 2 outer */
  ring: number;
  /** unistroke gesture that casts it ('spiral', 'zigzag', 'circle', 'triangle', 'v', 'wave', 'square', 'star', ...) */
  gesture?: string | null;
  /** the command kind it issues (must be a registered handler) */
  command: string;
  /** default parameters merged into the command */
  params: Record<string, unknown>;
  /** parameter schema for the UI (what the player can tune) */
  schema: Record<string, PowerParamDef>;
  target: (typeof POWER_TARGETS)[number];
  synonyms: string[];
  desc: string;
  /** worship cost and cooldown (ticks) in restraint mode; never charged by default (CONTRACT §1 pillar 1) */
  cost?: number;
  cooldown?: number;
  /** what witnesses make of it when the handler does not say (help / harm / wonder magnitudes, radius m) */
  witness?: { help?: number; harm?: number; wonder?: number; radius?: number };
}

/** an effector of a disaster (CONTRACT §11.3) */
export interface EffectorDef {
  type: 'impact' | 'area' | 'front' | 'spread' | 'quake' | 'water' | 'global' | 'spawn';
  /** when it acts: 'start' | 'end' (impact of a falling body) | 'each' (on its cadence for the whole life) | 0..1 (once, at that share of life) */
  at?: 'start' | 'end' | 'each' | number;
  /** cadence in ticks for 'each' (default 10) */
  every?: number;
  [k: string]: unknown;
}

export interface DisasterDef {
  id: string;
  name: string;
  desc: string;
  /** 'sky' | 'earth' | 'water' | 'fire' | 'life' | 'weather' | 'space' | 'world' */
  category: string;
  /** life in ticks [min, max] (-1 = until cancelled) */
  life: [number, number];
  /** life in planet years instead (a year-long eclipse lasts one year of the world it darkens) */
  lifeYears?: number;
  /** radius (m) and intensity defaults */
  radius: number;
  intensity: number;
  /** metres per tick a front / storm moves (0 = stays) */
  speed?: number;
  effectors: EffectorDef[];
  /** kind-specific render parameters (initial values; the sim updates them: altitude, height, plume ...) */
  render: Record<string, number>;
  /** what witnesses make of it (per hour of life near it) */
  witness?: { help?: number; harm?: number; wonder?: number };
  /** accident triggers it fires at settlements in reach (knowledge from disaster: meteor iron ...) */
  triggers?: string[];
  /** how it comes about on its own: expected events per planet-year where the conditions hold (0 = only by the god) */
  natural?: { rate: number; needs: string[] };
  synonyms?: string[];
}

export interface CreatureDef {
  id: string;
  name: string;
  /** body plan for the renderer's creaturegen ('ape', 'ox', 'cat', 'tortoise', 'wolf', ...) */
  body: string;
  /** height (m) when adopted and when fully grown */
  size: [number, number];
  /** walking speed m/s */
  speed: number;
  strength: number;
  intelligence: number;
  /** hunger per hour 0..1 */
  appetite: number;
  /** what it eats by preference ('animal', 'crop', 'tree', 'store', 'people', 'fish') */
  diet: string[];
  /** starting behaviour desires (weights 0..1) */
  desires: Record<string, number>;
  /** miracles it knows from the start (skill 0..1) */
  miracles?: Record<string, number>;
  /** content animal(s) a settlement's sacred beast must be for its people to raise one of this kind */
  animals?: string[];
  colors: string[];
}

/** the freeform parser's vocabulary (merged by mods: objects deep-merged, arrays concatenated) */
export type Lexicon = Record<string, unknown>;

export interface ContentPack {
  id: string;
  name?: string;
  version?: string;
  powers?: PowerDef[];
  disasters?: DisasterDef[];
  creatures?: CreatureDef[];
  lexicon?: Lexicon;
  plants?: PlantDef[];
  weather?: WeatherDef[];
  biomes?: BiomeDef[];
  /** replaces the whole rule list when present (rule order is meaningful) */
  biomeRules?: BiomeRule[];
  stars?: StarDef[];
  planetkinds?: PlanetKindDef[];
  ores?: OreDef[];
  scenarios?: ScenarioDef[];
  species?: SpeciesDef[];
  items?: ItemDef[];
  recipes?: RecipeDef[];
  buildings?: BuildingDef[];
  materials?: MaterialDef[];
  animals?: AnimalDef[];
  diseases?: DiseaseDef[];
  phonologies?: PhonologyDef[];
  events?: EventTemplateDef[];
  [section: string]: unknown;
}

// ───────────────────────────── registries ─────────────────────────────

export class Registry<T extends { id: string }> {
  readonly list: T[] = [];
  private index = new Map<string, number>();
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }

  /** add or replace (keeps the index of an existing id) */
  put(item: T): number {
    const at = this.index.get(item.id);
    if (at !== undefined) {
      this.list[at] = item;
      return at;
    }
    this.list.push(item);
    this.index.set(item.id, this.list.length - 1);
    return this.list.length - 1;
  }

  has(id: string): boolean {
    return this.index.has(id);
  }

  /** index of an id, or -1 */
  idx(id: string): number {
    const i = this.index.get(id);
    return i === undefined ? -1 : i;
  }

  /** the item for an id; throws a readable error when missing */
  get(id: string): T {
    const i = this.index.get(id);
    if (i === undefined) {
      const hint = suggest(id, this.ids());
      throw new ContentError([`unknown ${this.kind} '${id}'${hint ? ` — did you mean '${hint}'?` : ''}`]);
    }
    return this.list[i];
  }

  find(id: string): T | undefined {
    const i = this.index.get(id);
    return i === undefined ? undefined : this.list[i];
  }

  ids(): string[] {
    return this.list.map((x) => x.id);
  }

  get size(): number {
    return this.list.length;
  }
}

export class ContentError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(problems.length === 1 ? problems[0] : `content has ${problems.length} problems:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ContentError';
    this.problems = problems;
  }
}

/** Compiled numeric view of the plants for the vegetation hot loop (index = plant index). */
export interface PlantTable {
  count: number;
  type: Uint8Array; // 0 grass 1 shrub 2 tree 3 crop
  habitat: Uint8Array; // 0 land 1 shore 2 water
  temp: Float32Array; // 4 per plant
  moist: Float32Array; // 4 per plant
  soil: Float32Array;
  salinity: Float32Array;
  waterMin: Float32Array;
  waterMax: Float32Array;
  growth: Float32Array;
  spread: Float32Array;
  light: Float32Array;
  fuel: Float32Array;
  flammability: Float32Array;
  deciduous: Uint8Array;
  domestic: Uint8Array;
  /** plant indices of each functional type, wild ones first */
  byType: number[][];
}

export interface Content {
  packs: string[];
  plants: Registry<PlantDef>;
  plantTable: PlantTable;
  weather: Registry<WeatherDef>;
  biomes: Registry<BiomeDef>;
  biomeRules: BiomeRule[];
  stars: Registry<StarDef>;
  planetkinds: Registry<PlanetKindDef>;
  ores: Registry<OreDef>;
  scenarios: Registry<ScenarioDef>;
  species: Registry<SpeciesDef>;
  items: Registry<ItemDef>;
  recipes: Registry<RecipeDef>;
  buildings: Registry<BuildingDef>;
  materials: Registry<MaterialDef>;
  animals: Registry<AnimalDef>;
  diseases: Registry<DiseaseDef>;
  phonologies: Registry<PhonologyDef>;
  events: Registry<EventTemplateDef>;
  /** item tag -> item indices (content order) */
  itemsByTag: Map<string, number[]>;
  /** every place context a recipe may name: environment + building provides + accident events */
  contexts: Set<string>;
  /** sections this build does not understand yet (kept for later phases / round-tripping) */
  extra: Record<string, unknown[]>;
  // ── the god layer (phase 3) ──
  powers: Registry<PowerDef>;
  disasters: Registry<DisasterDef>;
  creatures: Registry<CreatureDef>;
  lexicon: Lexicon;
  /** the packs this content was built from, in order (the god layer rebuilds content with a runtime pack on top) */
  sources: ContentPack[];
}

/** the id of the pack the god layer builds at runtime (freeform inventions, species laws); never required by saves */
export const RUNTIME_PACK = 'runtime';

// ───────────────────────────── loading ─────────────────────────────

const KNOWN = ['plants', 'weather', 'biomes', 'biomeRules', 'stars', 'planetkinds', 'ores', 'scenarios', 'species', 'items', 'recipes',
  'buildings', 'materials', 'animals', 'diseases', 'phonologies', 'events', 'powers', 'disasters', 'creatures', 'lexicon'];

/**
 * Merge and validate packs (base first, then mods in order). Throws ContentError listing every problem.
 */
export function loadContent(packs: ContentPack[]): Content {
  const problems: string[] = [];
  const c: Content = {
    packs: [],
    plants: new Registry('plant'),
    plantTable: null as unknown as PlantTable,
    weather: new Registry('weather kind'),
    biomes: new Registry('biome'),
    biomeRules: [],
    stars: new Registry('star kind'),
    planetkinds: new Registry('planet kind'),
    ores: new Registry('ore'),
    scenarios: new Registry('scenario'),
    species: new Registry('species'),
    items: new Registry('item'),
    recipes: new Registry('recipe'),
    buildings: new Registry('building'),
    materials: new Registry('material'),
    animals: new Registry('animal'),
    diseases: new Registry('disease'),
    phonologies: new Registry('phonology'),
    events: new Registry('chronicle template'),
    itemsByTag: new Map(),
    contexts: new Set(),
    extra: {},
    powers: new Registry('power'),
    disasters: new Registry('disaster'),
    creatures: new Registry('creature'),
    lexicon: {},
    sources: packs.slice(),
  };
  for (const pack of packs) {
    if (!pack || typeof pack !== 'object') { problems.push('a content pack is not an object'); continue; }
    const pid = typeof pack.id === 'string' && pack.id ? pack.id : '(unnamed pack)';
    if (pid === '(unnamed pack)') problems.push('a content pack has no "id"');
    if (c.packs.includes(pid)) problems.push(`pack '${pid}' is loaded twice`);
    c.packs.push(pid);
    const where = (sec: string, i: number, id?: unknown) => `${pid} › ${sec}[${i}]${typeof id === 'string' ? ` '${id}'` : ''}`;
    const section = <T extends { id: string }>(name: string, reg: Registry<T>, check: (x: T, w: string, p: string[]) => void) => {
      const arr = pack[name];
      if (arr === undefined) return;
      if (!Array.isArray(arr)) { problems.push(`${pid} › '${name}' must be an array`); return; }
      arr.forEach((x: unknown, i: number) => {
        const o = x as T;
        const w = where(name, i, (o as { id?: unknown })?.id);
        if (!o || typeof o !== 'object') { problems.push(`${w}: not an object`); return; }
        if (typeof o.id !== 'string' || !o.id) { problems.push(`${w}: missing string "id"`); return; }
        const before = problems.length;
        check(o, w, problems);
        if (problems.length === before) reg.put(o);
      });
    };
    section('plants', c.plants, checkPlant);
    section('weather', c.weather, checkWeather);
    section('biomes', c.biomes, checkBiome);
    section('stars', c.stars, checkStar);
    section('planetkinds', c.planetkinds, checkPlanetKind);
    section('ores', c.ores, checkOre);
    section('scenarios', c.scenarios, checkScenario);
    section('species', c.species, checkSpecies);
    section('items', c.items, checkItem);
    section('recipes', c.recipes, checkRecipe);
    section('buildings', c.buildings, checkBuilding);
    section('materials', c.materials, checkMaterial);
    section('animals', c.animals, checkAnimal);
    section('diseases', c.diseases, checkDisease);
    section('phonologies', c.phonologies, checkPhonology);
    section('events', c.events, checkEventTemplate);
    section('powers', c.powers, checkPower);
    section('disasters', c.disasters, checkDisaster);
    section('creatures', c.creatures, checkCreature);
    if (pack.lexicon !== undefined) {
      if (!pack.lexicon || typeof pack.lexicon !== 'object' || Array.isArray(pack.lexicon)) problems.push(`${pid} › 'lexicon' must be an object`);
      else mergeLexicon(c.lexicon, pack.lexicon);
    }
    if (pack.biomeRules !== undefined) {
      if (!Array.isArray(pack.biomeRules)) problems.push(`${pid} › 'biomeRules' must be an array`);
      else c.biomeRules = pack.biomeRules.slice();
    }
    for (const k of Object.keys(pack)) {
      if (KNOWN.includes(k) || k === 'id' || k === 'name' || k === 'version' || k.startsWith('$')) continue;
      const v = pack[k];
      if (Array.isArray(v)) (c.extra[k] ??= []).push(...v);
    }
  }
  // cross references
  for (const p of c.plants.list) {
    if (p.domesticatesTo && !c.plants.has(p.domesticatesTo)) problems.push(ref('plant', p.id, 'domesticatesTo', p.domesticatesTo, c.plants));
  }
  for (const b of c.biomes.list) {
    const sp = b.paint?.species;
    if (sp) {
      for (const t of Object.keys(sp) as (keyof typeof sp)[]) {
        const id = sp[t];
        if (!id) continue;
        const pl = c.plants.find(id);
        if (!pl) problems.push(ref('biome', b.id, `paint.species.${t}`, id, c.plants));
        else if (pl.type !== t) problems.push(`biome '${b.id}': paint.species.${t} is '${id}', which is a ${pl.type}, not a ${t}`);
      }
    }
  }
  c.biomeRules.forEach((r, i) => {
    if (!r || typeof r.biome !== 'string') { problems.push(`biomeRules[${i}]: missing "biome"`); return; }
    if (!c.biomes.has(r.biome)) problems.push(ref(`biomeRules[${i}]`, r.biome, 'biome', r.biome, c.biomes));
    for (const cond of [...(r.all ?? []), ...(r.any ?? [])]) {
      if (!Array.isArray(cond) || cond.length !== 3 || typeof cond[0] !== 'string' || typeof cond[2] !== 'number' ||
        !['<', '<=', '>', '>=', '==', '!='].includes(cond[1])) {
        problems.push(`biomeRules[${i}] (${r.biome}): bad condition ${JSON.stringify(cond)} — use [variable, op, number]`);
      } else if (!BIOME_VARS.includes(cond[0])) {
        const hint = suggest(cond[0], BIOME_VARS);
        problems.push(`biomeRules[${i}] (${r.biome}): unknown variable '${cond[0]}'${hint ? ` — did you mean '${hint}'?` : ''}`);
      }
    }
  });
  if (c.biomes.size && c.biomeRules.length && (c.biomeRules[c.biomeRules.length - 1].all?.length || c.biomeRules[c.biomeRules.length - 1].any?.length)) {
    problems.push('biomeRules: the last rule must have no conditions (the fallback biome)');
  }
  for (const s of c.scenarios.list) {
    if (!c.stars.has(s.star)) problems.push(ref('scenario', s.id, 'star', s.star, c.stars));
    const walk = (pl: ScenarioPlanetDef, path: string) => {
      if (!c.planetkinds.has(pl.kind)) problems.push(ref('scenario', s.id, `${path} kind`, pl.kind, c.planetkinds));
      for (const [i, m] of (pl.moons ?? []).entries()) walk(m, `${path}.moons[${i}]`);
    };
    s.planets.forEach((pl, i) => walk(pl, `planets[${i}]`));
    if (s.focus !== undefined && (s.focus < 0 || s.focus >= s.planets.length)) problems.push(`scenario '${s.id}': focus ${s.focus} is not a planet index`);
  }
  crossCheckPeoples(c, problems);
  crossCheckGod(c, problems);
  if (problems.length) throw new ContentError(problems);
  c.plantTable = compilePlants(c.plants);
  return c;
}

export const BIOME_VARS = [
  'air', 'toxic', 'ocean', 'coast', 'water', 'seaIce', 'temp', 'moisture', 'alt', 'slope', 'sand', 'snow', 'ice', 'lava',
  'ash', 'soil', 'salinity', 'tree', 'shrub', 'grass',
];

function ref(kind: string, id: string, field: string, target: string, reg: Registry<{ id: string }>): string {
  const hint = suggest(target, reg.ids());
  return `${kind} '${id}': ${field} refers to unknown ${reg.kind} '${target}'${hint ? ` — did you mean '${hint}'?` : ''}`;
}

// ───────────────────────────── per-section checks ─────────────────────────────

function num(o: Record<string, unknown>, k: string, w: string, p: string[], lo = -Infinity, hi = Infinity): void {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v)) p.push(`${w}: "${k}" must be a number`);
  else if (v < lo || v > hi) p.push(`${w}: "${k}" = ${v} is outside ${lo}..${hi}`);
}

function str(o: Record<string, unknown>, k: string, w: string, p: string[]): void {
  if (typeof o[k] !== 'string' || !(o[k] as string).length) p.push(`${w}: "${k}" must be a non-empty string`);
}

function tuple(o: Record<string, unknown>, k: string, n: number, w: string, p: string[], ordered = true): void {
  const v = o[k];
  if (!Array.isArray(v) || v.length !== n || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
    p.push(`${w}: "${k}" must be an array of ${n} numbers`);
    return;
  }
  if (ordered) for (let i = 1; i < n; i++) if (v[i] < v[i - 1]) { p.push(`${w}: "${k}" must be in increasing order (${v.join(', ')})`); return; }
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

function checkPlant(x: PlantDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  if (!PLANT_TYPES.includes(x.type)) p.push(`${w}: "type" must be one of ${PLANT_TYPES.join(', ')} (got '${String(x.type)}')`);
  str(o, 'form', w, p);
  if (!['land', 'shore', 'water'].includes(x.habitat)) p.push(`${w}: "habitat" must be land, shore or water`);
  tuple(o, 'temp', 4, w, p);
  tuple(o, 'moisture', 4, w, p);
  tuple(o, 'water', 2, w, p);
  tuple(o, 'height', 2, w, p);
  num(o, 'soil', w, p, 0, 20);
  num(o, 'salinity', w, p, 0, 1);
  num(o, 'growth', w, p, 0, 5);
  num(o, 'spread', w, p, 0, 5);
  num(o, 'light', w, p, 0, 1);
  num(o, 'fuel', w, p, 0, 5);
  num(o, 'flammability', w, p, 0, 1);
  if (!x.colors || typeof x.colors !== 'object' || !COLOR.test(String(x.colors.leaf))) p.push(`${w}: "colors.leaf" must be a #rrggbb colour`);
  else for (const [k, v] of Object.entries(x.colors)) if (v != null && !COLOR.test(String(v))) p.push(`${w}: colors.${k} '${String(v)}' is not a #rrggbb colour`);
}

function checkWeather(x: WeatherDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  if (!PRECIP_TYPES.includes(x.precipType)) p.push(`${w}: "precipType" must be one of ${PRECIP_TYPES.join(', ')}`);
  for (const k of ['precip', 'cloud', 'fog', 'wind', 'spin', 'lightning', 'tempDelta', 'humidityDelta', 'speed']) num(o, k, w, p);
  tuple(o, 'radius', 2, w, p);
  tuple(o, 'life', 2, w, p);
  if (x.spawn !== null && (typeof x.spawn !== 'object' || typeof x.spawn.rate !== 'number')) p.push(`${w}: "spawn" must be null or an object with a numeric "rate"`);
  if (!x.render || typeof x.render !== 'object') p.push(`${w}: "render" hints object is required`);
}

function checkBiome(x: BiomeDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  if (!COLOR.test(String(x.color))) p.push(`${w}: "color" must be a #rrggbb colour`);
  if (!x.paint || typeof x.paint !== 'object') p.push(`${w}: "paint" object is required`);
}

function checkStar(x: StarDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'kind', w, p);
  num(o, 'luminosity', w, p, 0, 1e7);
  num(o, 'temperature', w, p, 100, 1e7);
  num(o, 'radius', w, p, 1, 1e8);
  num(o, 'activity', w, p, 0, 1);
}

function checkOre(x: OreDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  num(o, 'rarity', w, p, 0, 10);
  if (!x.geology || typeof x.geology !== 'object') p.push(`${w}: "geology" weights object is required`);
  else for (const k of Object.keys(x.geology)) if (!GEOLOGY.includes(k)) p.push(`${w}: unknown geology '${k}' (use ${GEOLOGY.join(', ')})`);
}

export const GEOLOGY = ['mountain', 'volcanic', 'sedimentary', 'basin', 'coast', 'crater', 'river'];

function checkPlanetKind(x: PlanetKindDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  num(o, 'radius', w, p, 100, 1e6);
  num(o, 'n', w, p, 4, 160);
  num(o, 'gravity', w, p, 0, 100);
  num(o, 'dayHours', w, p, 0.5, 10000);
  num(o, 'axialTilt', w, p, -180, 180);
  num(o, 'oceanFraction', w, p, 0, 1);
  num(o, 'vegetation', w, p, 0, 3);
  if (!x.atmosphere || typeof x.atmosphere.pressure !== 'number') p.push(`${w}: "atmosphere" with a numeric pressure is required`);
  if (!x.relief || typeof x.relief !== 'object') p.push(`${w}: "relief" object is required`);
  if (!x.surface || typeof x.surface !== 'object') p.push(`${w}: "surface" object is required`);
  if (!x.liquid || typeof x.liquid.freeze !== 'number' || typeof x.liquid.boil !== 'number') p.push(`${w}: "liquid" needs numeric freeze and boil`);
}

function checkScenario(x: ScenarioDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'star', w, p);
  if (!Array.isArray(x.planets) || x.planets.length === 0) p.push(`${w}: "planets" must be a non-empty array`);
  else {
    const walk = (pl: ScenarioPlanetDef, path: string) => {
      if (!pl || typeof pl.kind !== 'string' || typeof pl.name !== 'string') p.push(`${w}: ${path} needs "name" and "kind"`);
      else if (!pl.orbit || typeof pl.orbit.a !== 'number' || !(pl.orbit.a > 0)) p.push(`${w}: ${path} needs an orbit with a > 0`);
      for (const [i, m] of (pl?.moons ?? []).entries()) walk(m, `${path}.moons[${i}]`);
    };
    x.planets.forEach((pl, i) => walk(pl, `planets[${i}]`));
  }
  if (!Array.isArray(x.peoples)) p.push(`${w}: "peoples" must be an array (may be empty)`);
}

// ───────────────────────────── helpers ─────────────────────────────

function compilePlants(reg: Registry<PlantDef>): PlantTable {
  const n = reg.size;
  const t: PlantTable = {
    count: n,
    type: new Uint8Array(n), habitat: new Uint8Array(n), temp: new Float32Array(n * 4), moist: new Float32Array(n * 4),
    soil: new Float32Array(n), salinity: new Float32Array(n), waterMin: new Float32Array(n), waterMax: new Float32Array(n),
    growth: new Float32Array(n), spread: new Float32Array(n), light: new Float32Array(n), fuel: new Float32Array(n),
    flammability: new Float32Array(n), deciduous: new Uint8Array(n), domestic: new Uint8Array(n),
    byType: [[], [], [], []],
  };
  reg.list.forEach((p, i) => {
    const ti = PLANT_TYPES.indexOf(p.type);
    t.type[i] = ti;
    t.habitat[i] = p.habitat === 'water' ? 2 : p.habitat === 'shore' ? 1 : 0;
    for (let k = 0; k < 4; k++) { t.temp[i * 4 + k] = p.temp[k]; t.moist[i * 4 + k] = p.moisture[k]; }
    t.soil[i] = p.soil;
    t.salinity[i] = p.salinity;
    t.waterMin[i] = p.water[0];
    t.waterMax[i] = p.water[1];
    t.growth[i] = p.growth;
    t.spread[i] = p.spread;
    t.light[i] = p.light;
    t.fuel[i] = p.fuel;
    t.flammability[i] = p.flammability;
    t.deciduous[i] = p.deciduous ? 1 : 0;
    t.domestic[i] = p.domestic ? 1 : 0;
  });
  for (let ti = 0; ti < 4; ti++) {
    const wild: number[] = [];
    const dom: number[] = [];
    for (let i = 0; i < n; i++) if (t.type[i] === ti) (t.domestic[i] ? dom : wild).push(i);
    t.byType[ti] = [...wild, ...dom];
  }
  return t;
}

/** closest id by edit distance (for "did you mean"), or '' when nothing is close */
export function suggest(word: string, options: string[]): string {
  let best = '';
  let bestD = Infinity;
  const w = String(word).toLowerCase();
  for (const o of options) {
    const d = editDistance(w, o.toLowerCase());
    if (d < bestD) { bestD = d; best = o; }
  }
  return bestD <= Math.max(2, Math.floor(w.length / 3)) ? best : '';
}

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}

/** parse '#rrggbb' -> [r, g, b] 0..1 (render hints helper; also used for chronicle-free colour maths) */
export function hexColor(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

// ───────────────────────────── peoples: per-entry checks ─────────────────────────────

function strArr(o: Record<string, unknown>, k: string, w: string, p: string[], allowEmpty = true): void {
  const v = o[k];
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) p.push(`${w}: "${k}" must be an array of strings`);
  else if (!allowEmpty && v.length === 0) p.push(`${w}: "${k}" must not be empty`);
}

function ioArr(o: Record<string, unknown>, k: string, w: string, p: string[]): void {
  const v = o[k];
  if (!Array.isArray(v)) { p.push(`${w}: "${k}" must be an array of { item | tag, qty }`); return; }
  v.forEach((io: unknown, i: number) => {
    const x = io as RecipeIO;
    if (!x || typeof x !== 'object' || (typeof x.item !== 'string' && typeof x.tag !== 'string')) p.push(`${w}: ${k}[${i}] needs "item" or "tag"`);
    else if (typeof x.qty !== 'number' || !(x.qty > 0)) p.push(`${w}: ${k}[${i}] needs a positive "qty"`);
  });
}

function oneOf(o: Record<string, unknown>, k: string, vals: readonly string[], w: string, p: string[]): void {
  if (!vals.includes(String(o[k]))) {
    const hint = suggest(String(o[k]), [...vals]);
    p.push(`${w}: "${k}" must be one of ${vals.join(', ')} (got '${String(o[k])}')${hint ? ` — did you mean '${hint}'?` : ''}`);
  }
}

function checkSpecies(x: SpeciesDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  for (const k of ['name', 'plural', 'adjective', 'phonology']) str(o, k, w, p);
  oneOf(o, 'body', BODY_PLANS, w, p);
  num(o, 'size', w, p, 0.05, 100);
  num(o, 'speed', w, p, 0.01, 20);
  num(o, 'swim', w, p, 0, 20);
  num(o, 'lifespan', w, p, 1, 10000);
  num(o, 'maturity', w, p, 0, 1000);
  num(o, 'elder', w, p, 0, 10000);
  num(o, 'fertility', w, p, 0, 50);
  tuple(o, 'temp', 4, w, p);
  oneOf(o, 'breathes', ['o2', 'methane', 'none'], w, p);
  strArr(o, 'habitat', w, p, false);
  strArr(o, 'forage', w, p, false);
  for (const f of x.forage ?? []) if (!FORAGE_SOURCES.includes(f)) p.push(`${w}: forage '${f}' is not one of ${FORAGE_SOURCES.join(', ')}`);
  if (typeof x.nocturnal !== 'boolean') p.push(`${w}: "nocturnal" must be true or false`);
  if (!x.diet || typeof x.diet !== 'object') p.push(`${w}: "diet" must be an object of food tag -> weight`);
  if (!x.needs || typeof x.needs !== 'object') p.push(`${w}: "needs" must be an object of need -> weight`);
  else for (const k of Object.keys(x.needs)) if (!NEEDS.includes(k as NeedName)) p.push(`${w}: unknown need '${k}'${suggest(k, [...NEEDS]) ? ` — did you mean '${suggest(k, [...NEEDS])}'?` : ''}`);
  if (!x.traits || typeof x.traits !== 'object') p.push(`${w}: "traits" must be an object of trait -> mean 0..1`);
  else for (const t of TRAITS) if (typeof x.traits[t] !== 'number') p.push(`${w}: traits.${t} must be a number 0..1`);
  if (!x.colors || !Array.isArray(x.colors.skin) || !x.colors.skin.length) p.push(`${w}: "colors.skin" must list at least one #rrggbb`);
  else for (const list of [x.colors.skin, x.colors.hair ?? [], x.colors.cloth ?? []]) for (const col of list) if (!COLOR.test(col)) p.push(`${w}: colour '${col}' is not #rrggbb`);
  if (!x.style || !Array.isArray(x.style.materials)) p.push(`${w}: "style.materials" must be an array`);
  if (!x.god || typeof x.god.awe !== 'number' || typeof x.god.fear !== 'number') p.push(`${w}: "god" needs numeric awe and fear`);
  strArr(o, 'start', w, p);
  strArr(o, 'taboos', w, p);
  if (x.hive !== null && x.hive !== undefined && (!Array.isArray(x.hive.castes) || !Array.isArray(x.hive.shares) || x.hive.castes.length !== x.hive.shares.length)) {
    p.push(`${w}: "hive" needs castes and shares of the same length`);
  }
}

function checkItem(x: ItemDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  strArr(o, 'tags', w, p);
  num(o, 'weight', w, p, 0, 1e7);
  num(o, 'value', w, p, 0, 1e7);
  for (const k of ['food', 'fuel', 'decay', 'warmth', 'quality']) if (o[k] !== undefined) num(o, k, w, p, 0, k === 'decay' || k === 'warmth' ? 1 : 1e4);
}

function checkRecipe(x: RecipeDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  oneOf(o, 'kind', ['craft', 'gather', 'idea', 'build'], w, p);
  ioArr(o, 'inputs', w, p);
  strArr(o, 'tools', w, p);
  strArr(o, 'knowledge', w, p);
  if (!x.place || typeof x.place !== 'object') p.push(`${w}: "place" must be an object (may be empty)`);
  if (!Array.isArray(x.outputs)) p.push(`${w}: "outputs" must be an array`);
  num(o, 'time', w, p, 0, 1e6);
  oneOf(o, 'skill', SKILLS, w, p);
  num(o, 'teach', w, p, 0, 1);
  oneOf(o, 'era', ERAS, w, p);
  if (!x.discover || typeof x.discover.base !== 'number' || !Array.isArray(x.discover.triggers) || typeof x.discover.curiosity !== 'number') {
    p.push(`${w}: "discover" needs base (0..1), triggers (array) and curiosity`);
  } else if (x.discover.base < 0 || x.discover.base > 1) p.push(`${w}: discover.base must be within 0..1`);
  if (x.kind === 'craft' && (!Array.isArray(x.outputs) || !x.outputs.some((q) => q && (q.item || q.knowledge)))) p.push(`${w}: a craft recipe needs at least one item output`);
  if (x.gather && (typeof x.gather.task !== 'string' || !Array.isArray(x.gather.items))) p.push(`${w}: "gather" needs a task and items`);
}

function checkBuilding(x: BuildingDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'function', w, p);
  str(o, 'recipe', w, p);
  strArr(o, 'provides', w, p);
  strArr(o, 'materials', w, p, false);
  num(o, 'footprint', w, p, 0.2, 500);
  num(o, 'capacity', w, p, 0, 10000);
  num(o, 'storage', w, p, 0, 1e6);
  num(o, 'cost', w, p, 0, 1e5);
  num(o, 'work', w, p, 1, 1e7);
  num(o, 'hp', w, p, 1, 1e6);
  num(o, 'decay', w, p, 0, 1);
  num(o, 'heat', w, p, 0, 5000);
  num(o, 'light', w, p, 0, 10);
  oneOf(o, 'era', ERAS, w, p);
}

function checkMaterial(x: MaterialDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  ioArr(o, 'items', w, p);
  if (x.knowledge !== null && typeof x.knowledge !== 'string') p.push(`${w}: "knowledge" must be a recipe id or null`);
  if (!COLOR.test(String(x.color))) p.push(`${w}: "color" must be #rrggbb`);
  for (const k of ['roughness', 'flammability', 'insulation']) num(o, k, w, p, 0, 1);
  num(o, 'strength', w, p, 0, 100);
  oneOf(o, 'era', ERAS, w, p);
}

function checkAnimal(x: AnimalDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'body', w, p);
  oneOf(o, 'kind', ['herbivore', 'predator', 'scavenger', 'fish', 'bird', 'insect', 'domestic'], w, p);
  oneOf(o, 'habitat', ['land', 'water', 'sea', 'air'], w, p);
  num(o, 'size', w, p, 0.001, 1000);
  num(o, 'speed', w, p, 0, 50);
  tuple(o, 'herd', 2, w, p);
  tuple(o, 'temp', 4, w, p);
  strArr(o, 'diet', w, p);
  strArr(o, 'biomes', w, p);
  ioArr(o, 'products', w, p);
  num(o, 'danger', w, p, 0, 1);
  num(o, 'flee', w, p, 0, 1);
  num(o, 'breed', w, p, 0, 100);
  if (!Array.isArray(x.colors) || x.colors.some((col) => !COLOR.test(col))) p.push(`${w}: "colors" must be #rrggbb strings`);
}

function checkDisease(x: DiseaseDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  oneOf(o, 'transmission', ['contact', 'water', 'air', 'food', 'animal'], w, p);
  for (const k of ['contagion', 'mortality', 'immunity']) num(o, k, w, p, 0, 1);
  num(o, 'duration', w, p, 0.01, 10000);
  num(o, 'crowd', w, p, 0, 1e6);
  str(o, 'medicine', w, p);
  strArr(o, 'origin', w, p);
  if (x.species !== null && !Array.isArray(x.species)) p.push(`${w}: "species" must be an array of species ids or null`);
}

function checkPhonology(x: PhonologyDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  strArr(o, 'onsets', w, p, false);
  strArr(o, 'vowels', w, p, false);
  strArr(o, 'codas', w, p, false);
  tuple(o, 'syllables', 2, w, p);
  tuple(o, 'personal', 2, w, p);
  if (typeof x.sep !== 'string') p.push(`${w}: "sep" must be a string (may be empty)`);
  if (!x.features || typeof x.features !== 'object') p.push(`${w}: "features" must map site features to phrases`);
}

function checkEventTemplate(x: EventTemplateDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'kind', w, p);
  num(o, 'weight', w, p, 0, 3);
  strArr(o, 'text', w, p, false);
}

/** references between the peoples sections (after every pack merged); also builds the tag index and context set */
function crossCheckPeoples(c: Content, problems: string[]): void {
  c.itemsByTag.clear();
  c.items.list.forEach((it, i) => {
    for (const t of it.tags ?? []) {
      let l = c.itemsByTag.get(t);
      if (!l) c.itemsByTag.set(t, (l = []));
      l.push(i);
    }
  });
  c.contexts.clear();
  for (const k of ENV_CONTEXTS) c.contexts.add(k);
  for (const k of EVENT_TRIGGERS) c.contexts.add(k);
  for (const b of c.buildings.list) for (const k of b.provides ?? []) c.contexts.add(k);
  const ctxList = [...c.contexts];
  const itemRef = (who: string, io: RecipeIO, field: string) => {
    if (io.item !== undefined && !c.items.has(io.item)) problems.push(ref(who.split(' ')[0], who.split(' ').slice(1).join(' '), field, io.item, c.items));
    if (io.tag !== undefined && !c.itemsByTag.has(io.tag)) problems.push(`${who}: ${field} names tag '${io.tag}', which no item carries`);
  };
  for (const s of c.species.list) {
    if (!c.phonologies.has(s.phonology)) problems.push(ref('species', s.id, 'phonology', s.phonology, c.phonologies));
    for (const k of s.start ?? []) if (!c.recipes.has(k)) problems.push(ref('species', s.id, 'start', k, c.recipes));
    for (const k of s.taboos ?? []) if (!c.recipes.has(k)) problems.push(ref('species', s.id, 'taboos', k, c.recipes));
    for (const m of s.style?.materials ?? []) if (!c.materials.has(m)) problems.push(ref('species', s.id, 'style.materials', m, c.materials));
    for (const t of Object.keys(s.diet ?? {})) if (!c.itemsByTag.has(t)) problems.push(`species '${s.id}': diet names food tag '${t}', which no item carries`);
  }
  for (const it of c.items.list) if (it.material && !c.materials.has(it.material)) problems.push(ref('item', it.id, 'material', it.material, c.materials));
  for (const r of c.recipes.list) {
    const who = `recipe ${r.id}`;
    for (const io of r.inputs ?? []) itemRef(who, io, 'inputs');
    for (const t of r.tools ?? []) if (!c.itemsByTag.has(t)) problems.push(`recipe '${r.id}': tool tag '${t}' is carried by no item`);
    for (const k of r.knowledge ?? []) if (!c.recipes.has(k)) problems.push(ref('recipe', r.id, 'knowledge', k, c.recipes));
    if (r.knowledge?.includes(r.id)) problems.push(`recipe '${r.id}' lists itself as a prerequisite`);
    for (const o of r.outputs ?? []) {
      if (o.item !== undefined && !c.items.has(o.item)) problems.push(ref('recipe', r.id, 'outputs.item', o.item, c.items));
      if (o.building !== undefined && !c.buildings.has(o.building)) problems.push(ref('recipe', r.id, 'outputs.building', o.building, c.buildings));
      if (o.knowledge !== undefined && !c.recipes.has(o.knowledge)) problems.push(ref('recipe', r.id, 'outputs.knowledge', o.knowledge, c.recipes));
    }
    const needs = r.place?.needs === undefined ? [] : Array.isArray(r.place.needs) ? r.place.needs : [r.place.needs];
    for (const k of [...needs, ...(r.place?.near ?? [])]) {
      if (!c.contexts.has(k)) { const h = suggest(k, ctxList); problems.push(`recipe '${r.id}': place context '${k}' is unknown${h ? ` — did you mean '${h}'?` : ''}`); }
    }
    for (const b of r.place?.biome ?? []) if (!c.biomes.has(b)) problems.push(ref('recipe', r.id, 'place.biome', b, c.biomes));
    for (const k of r.discover?.triggers ?? []) {
      if (!c.contexts.has(k)) { const h = suggest(k, ctxList); problems.push(`recipe '${r.id}': discover trigger '${k}' is unknown${h ? ` — did you mean '${h}'?` : ''}`); }
    }
    for (const it of r.gather?.items ?? []) if (!c.items.has(it)) problems.push(ref('recipe', r.id, 'gather.items', it, c.items));
    for (const sp of r.species ?? []) if (!c.species.has(sp)) problems.push(ref('recipe', r.id, 'species', sp, c.species));
  }
  // prerequisite cycles would make a recipe unlearnable by any path except a direct gift: refuse them
  const state = new Map<string, number>();
  const visit = (id: string, path: string[]): void => {
    const st = state.get(id);
    if (st === 2) return;
    if (st === 1) { problems.push(`recipes: prerequisite cycle ${[...path, id].join(' -> ')}`); return; }
    state.set(id, 1);
    for (const k of c.recipes.find(id)?.knowledge ?? []) if (c.recipes.has(k)) visit(k, [...path, id]);
    state.set(id, 2);
  };
  for (const r of c.recipes.list) visit(r.id, []);
  // hot work needs a workplace hot enough, of the kind it names, that can be built WITHOUT the recipe itself (a smelter
  // that only smelters can build would lock its age away for ever)
  const needsOf = (id: string): Set<string> => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const k = stack.pop()!;
      for (const q of c.recipes.find(k)?.knowledge ?? []) if (!out.has(q)) { out.add(q); stack.push(q); }
    }
    return out;
  };
  const eraOf = (e: string | undefined) => Math.max(0, ERAS.indexOf((e ?? 'stone') as Era));
  for (const r of c.recipes.list) {
    const heat = r.place?.heat ?? 0;
    if (heat <= 0) continue;
    const needs = r.place?.needs === undefined ? [] : Array.isArray(r.place.needs) ? r.place.needs : [r.place.needs];
    const places = c.buildings.list.filter((b) => (b.heat ?? 0) >= heat && needs.every((k) => (b.provides ?? []).includes(k) || (ENV_CONTEXTS as readonly string[]).includes(k)));
    if (heat > 700 && !places.length) {
      problems.push(`recipe '${r.id}': no building reaches ${heat} °C${needs.length ? ` and provides ${needs.join(' + ')}` : ''}`);
      continue;
    }
    // self-locked (every such workplace needs the recipe itself): the first try happens at a fire of its age or before
    if (places.length && places.every((b) => b.recipe === r.id || needsOf(b.recipe).has(r.id))) {
      const fire = c.buildings.list.some((b) => (b.heat ?? 0) > 0 && b.recipe !== r.id && !needsOf(b.recipe).has(r.id) && eraOf(b.era) <= eraOf(r.era));
      if (!fire) problems.push(`recipe '${r.id}' needs ${heat} °C at ${places.map((b) => b.id).join(' / ')}, which only those who already know it can build, and no older fire to first try it at`);
    }
  }
  for (const b of c.buildings.list) {
    if (!c.recipes.has(b.recipe)) problems.push(ref('building', b.id, 'recipe', b.recipe, c.recipes));
    for (const m of b.materials ?? []) if (!c.materials.has(m)) problems.push(ref('building', b.id, 'materials', m, c.materials));
    for (const sp of b.species ?? []) if (!c.species.has(sp)) problems.push(ref('building', b.id, 'species', sp, c.species));
  }
  for (const m of c.materials.list) {
    for (const io of m.items ?? []) itemRef(`material ${m.id}`, io, 'items');
    if (m.knowledge && !c.recipes.has(m.knowledge)) problems.push(ref('material', m.id, 'knowledge', m.knowledge, c.recipes));
  }
  for (const a of c.animals.list) {
    for (const io of a.products ?? []) itemRef(`animal ${a.id}`, io, 'products');
    if (a.domesticatesTo && !c.animals.has(a.domesticatesTo)) problems.push(ref('animal', a.id, 'domesticatesTo', a.domesticatesTo, c.animals));
    for (const b of a.biomes ?? []) if (!c.biomes.has(b)) problems.push(ref('animal', a.id, 'biomes', b, c.biomes));
  }
  for (const d of c.diseases.list) {
    if (!c.recipes.has(d.medicine)) problems.push(ref('disease', d.id, 'medicine', d.medicine, c.recipes));
    for (const sp of d.species ?? []) if (!c.species.has(sp)) problems.push(ref('disease', d.id, 'species', sp, c.species));
    for (const b of d.origin ?? []) if (!c.biomes.has(b)) problems.push(ref('disease', d.id, 'origin', b, c.biomes));
  }
  for (const s of c.scenarios.list) {
    (s.peoples ?? []).forEach((pe, i) => {
      const e = pe as { species?: string; era?: string };
      if (e && typeof e === 'object' && e.species !== undefined && !c.species.has(e.species)) problems.push(ref('scenario', s.id, `peoples[${i}].species`, e.species, c.species));
      if (e && typeof e === 'object' && e.era !== undefined && !ERAS.includes(e.era as Era)) problems.push(`scenario '${s.id}': peoples[${i}].era '${e.era}' is not one of ${ERAS.join(', ')}`);
    });
  }
}

// ───────────────────────────── the god layer: checks (phase 3) ─────────────────────────────

const EFFECTOR_TYPES = ['impact', 'area', 'front', 'spread', 'quake', 'water', 'global', 'spawn'];
/** natural-disaster conditions a planet can be tested for (god/disasters.ts naturalRolls) */
export const DISASTER_NEEDS = [
  'air', 'volcanic', 'rift', 'mountain', 'coast', 'sea', 'dry', 'wet', 'hot', 'cold', 'forest', 'grass', 'crops', 'people', 'herds',
  'sand', 'moon', 'magnetism', 'storms', 'pole', 'settled',
];
const CREATURE_DIET = ['animal', 'crop', 'tree', 'store', 'people', 'fish', 'grass', 'rock'];
export const CREATURE_BEHAVIOURS = [
  'eat', 'sleep', 'play', 'throw', 'help', 'attack', 'cast', 'impress', 'terrify', 'poop', 'explore', 'follow', 'eat-people', 'throw-people',
];

function checkPower(x: PowerDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'icon', w, p);
  str(o, 'command', w, p);
  str(o, 'desc', w, p);
  oneOf(o, 'category', POWER_CATEGORIES, w, p);
  oneOf(o, 'target', POWER_TARGETS, w, p);
  num(o, 'ring', w, p, 0, 3);
  strArr(o, 'synonyms', w, p, false);
  if (!x.params || typeof x.params !== 'object' || Array.isArray(x.params)) p.push(`${w}: "params" must be an object of default parameters`);
  if (!x.schema || typeof x.schema !== 'object' || Array.isArray(x.schema)) { p.push(`${w}: "schema" must be an object of parameter schemas`); return; }
  for (const [k, s] of Object.entries(x.schema)) {
    if (!s || typeof s !== 'object') { p.push(`${w}: schema.${k} must be an object`); continue; }
    if (!PARAM_TYPES.includes(s.type)) p.push(`${w}: schema.${k}.type '${String(s.type)}' is not one of ${PARAM_TYPES.join(', ')}`);
    if (s.min !== undefined && s.max !== undefined && s.min > s.max) p.push(`${w}: schema.${k} has min > max`);
  }
  if (x.gesture !== undefined && x.gesture !== null && typeof x.gesture !== 'string') p.push(`${w}: "gesture" must be a string or null`);
  for (const k of ['cost', 'cooldown'] as const) if (x[k] !== undefined) num(o, k, w, p, 0, 1e7);
}

function checkDisaster(x: DisasterDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'desc', w, p);
  str(o, 'category', w, p);
  num(o, 'radius', w, p, 1, 1e6);
  num(o, 'intensity', w, p, 0, 100);
  if (!Array.isArray(x.life) || x.life.length !== 2 || x.life.some((v) => typeof v !== 'number')) p.push(`${w}: "life" must be [min, max] ticks (-1 = until cancelled)`);
  if (!Array.isArray(x.effectors) || !x.effectors.length) p.push(`${w}: "effectors" must be a non-empty array`);
  else x.effectors.forEach((e, i) => {
    if (!e || typeof e !== 'object' || !EFFECTOR_TYPES.includes(String(e.type))) p.push(`${w}: effectors[${i}].type must be one of ${EFFECTOR_TYPES.join(', ')}`);
  });
  if (!x.render || typeof x.render !== 'object') p.push(`${w}: "render" parameters object is required`);
  if (x.natural !== undefined) {
    if (!x.natural || typeof x.natural.rate !== 'number' || !Array.isArray(x.natural.needs)) p.push(`${w}: "natural" needs a numeric rate and a needs array`);
    else for (const k of x.natural.needs) if (!DISASTER_NEEDS.includes(k)) p.push(`${w}: natural need '${k}' is unknown${suggest(k, DISASTER_NEEDS) ? ` — did you mean '${suggest(k, DISASTER_NEEDS)}'?` : ''}`);
  }
}

function checkCreature(x: CreatureDef, w: string, p: string[]): void {
  const o = x as unknown as Record<string, unknown>;
  str(o, 'name', w, p);
  str(o, 'body', w, p);
  tuple(o, 'size', 2, w, p);
  num(o, 'speed', w, p, 0.05, 50);
  num(o, 'strength', w, p, 0, 10);
  num(o, 'intelligence', w, p, 0, 10);
  num(o, 'appetite', w, p, 0, 1);
  strArr(o, 'diet', w, p, false);
  for (const d of x.diet ?? []) if (!CREATURE_DIET.includes(d)) p.push(`${w}: diet '${d}' is not one of ${CREATURE_DIET.join(', ')}`);
  if (!x.desires || typeof x.desires !== 'object') p.push(`${w}: "desires" must map behaviours to weights`);
  else for (const k of Object.keys(x.desires)) if (!CREATURE_BEHAVIOURS.includes(k)) p.push(`${w}: unknown behaviour '${k}'${suggest(k, CREATURE_BEHAVIOURS) ? ` — did you mean '${suggest(k, CREATURE_BEHAVIOURS)}'?` : ''}`);
  if (!Array.isArray(x.colors) || x.colors.some((col) => !COLOR.test(col))) p.push(`${w}: "colors" must be #rrggbb strings`);
}

/** deep merge: objects merge key by key, arrays concatenate (deduplicated), scalars replace */
function mergeLexicon(into: Record<string, unknown>, add: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(add)) {
    if (k.startsWith('$')) continue;
    const cur = into[k];
    if (Array.isArray(v)) {
      const base = Array.isArray(cur) ? cur.slice() : [];
      for (const e of v) if (!base.some((b) => JSON.stringify(b) === JSON.stringify(e))) base.push(e);
      into[k] = base;
    } else if (v && typeof v === 'object') {
      const base = cur && typeof cur === 'object' && !Array.isArray(cur) ? cur as Record<string, unknown> : {};
      into[k] = base;
      mergeLexicon(base, v as Record<string, unknown>);
    } else into[k] = v;
  }
}

/** references from the god sections into the rest of the content */
function crossCheckGod(c: Content, problems: string[]): void {
  for (const d of c.disasters.list) {
    for (const t of d.triggers ?? []) if (!c.contexts.has(t)) problems.push(`disaster '${d.id}': trigger '${t}' is unknown`);
    for (const e of d.effectors ?? []) {
      if (typeof e.animal === 'string' && !c.animals.has(e.animal)) problems.push(ref('disaster', d.id, 'effectors.animal', e.animal, c.animals));
      if (typeof e.weather === 'string' && !c.weather.has(e.weather)) problems.push(ref('disaster', d.id, 'effectors.weather', e.weather, c.weather));
      if (typeof e.disease === 'string' && !c.diseases.has(e.disease)) problems.push(ref('disaster', d.id, 'effectors.disease', e.disease, c.diseases));
      if (typeof e.material === 'string' && !['soil', 'sand', 'snow', 'ash', 'ice', 'rock', 'lava'].includes(e.material)) problems.push(`disaster '${d.id}': material '${e.material}' is not a terrain material`);
    }
  }
  for (const cr of c.creatures.list) for (const a of cr.animals ?? []) if (!c.animals.has(a)) problems.push(ref('creature', cr.id, 'animals', a, c.animals));
  for (const pw of c.powers.list) {
    // a disaster power must name a known disaster; a weather power a known weather kind
    const kind = pw.params?.kind;
    if (pw.command === 'disaster.spawn' && typeof kind === 'string' && kind !== 'random' && !c.disasters.has(kind)) problems.push(ref('power', pw.id, 'params.kind', kind, c.disasters));
    if ((pw.command === 'weather.paint' || pw.command === 'weather.global') && typeof kind === 'string' && kind !== 'none' && !c.weather.has(kind)) problems.push(ref('power', pw.id, 'params.kind', kind, c.weather));
    if (pw.command === 'creature.adopt' && typeof pw.params?.template === 'string' && !c.creatures.has(pw.params.template)) problems.push(ref('power', pw.id, 'params.template', pw.params.template as string, c.creatures));
  }
}
