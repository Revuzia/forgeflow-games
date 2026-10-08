// GENESIS — content loading (CONTRACT.md §9): base pack + mod packs -> validated, indexed registries.
//
// Content is data. A pack is a JSON object with optional sections (plants, weather, biomes, biomeRules, stars,
// planetkinds, ores, scenarios, ... later: species, items, recipes, buildings, powers). Packs are merged in order: an
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

export interface ContentPack {
  id: string;
  name?: string;
  version?: string;
  plants?: PlantDef[];
  weather?: WeatherDef[];
  biomes?: BiomeDef[];
  /** replaces the whole rule list when present (rule order is meaningful) */
  biomeRules?: BiomeRule[];
  stars?: StarDef[];
  planetkinds?: PlanetKindDef[];
  ores?: OreDef[];
  scenarios?: ScenarioDef[];
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
  /** sections this build does not understand yet (kept for later phases / round-tripping) */
  extra: Record<string, unknown[]>;
}

// ───────────────────────────── loading ─────────────────────────────

const KNOWN = ['plants', 'weather', 'biomes', 'biomeRules', 'stars', 'planetkinds', 'ores', 'scenarios'];

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
    extra: {},
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
