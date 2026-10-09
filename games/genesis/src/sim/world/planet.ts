// GENESIS — Planet: one world's parameters, per-cell fields (CONTRACT.md §7) and solver state, plus generation (§6.5).
//
// Storage rules:
//   * Every per-cell field is a typed array on `planet.f` (hot loops index them directly). `water` is Float64 because
//     the pipe solver must conserve volume to ~1e-12; everything else is Float32. The snapshot always ships Float32
//     copies.
//   * Solver state that affects the future (pipe fluxes, active-set flags, ocean mask, prevailing winds, slow climate
//     means, weather overlays) lives in `planet.s`. Save, load and hash walk `planetArrays()` — one ordered list — so a
//     loaded planet continues bit-identically.
//   * Object state (params, weather systems, springs, vents, firsts, RNG streams) is JSON in the save header.
//   * Derived calendar values (spin, hour, day, year) are never stored: `paramsAt(tick)` computes them from anchors,
//     so the state hash cannot depend on when snapshots happened to be taken.
//
// Ice convention (shared with the renderer): `ice` on DRY ground is glacier / ground ice and is part of `surface`; the
// published `ice` field also carries floating ice (`s.seaIce`) on wet cells, where it is NOT part of surface — the
// renderer draws a frozen water surface there. Lava sits ON the surface like water (lava surface = surface + lava).

import type { AtmosphereParams, FieldName, OrbitParams, PlanetParams } from '../types.ts';
import type { Content, PlanetKindDef } from '../content.ts';
import { getGrid, type IcoGrid } from '../grid/icogrid.ts';
import { getGeo, type GridGeo } from '../grid/geo.ts';
import { Noise3 } from '../grid/noise.ts';
import { surfaceGradients, type GroundSource } from '../grid/surface.ts';
import { Rng, hashFloat, type RngState } from '../core/rng.ts';
import type { TypedArray } from '../core/hash.ts';
import {
  accumulate, distanceFrom, priorityFlood, quantile, randomDir, receivers, smoothstep, sortDescending, stampCrater, stampVolcano,
} from './gen.ts';
import { orbitCount, yearFraction } from './orbits.ts';
import { PeopleState, type PeopleJson } from '../people/state.ts';
import { recipeTable } from '../recipes/recipes.ts';

// ───────────────────────────── fields ─────────────────────────────

/** Fields shipped to the client (types.ts FieldName). Order is the save / hash order. */
/** a climate memory this many steps old has its full (about a year) span (PlanetSolverState.climMem) */
export const CLIM_MEM_FULL = 1e6;

export const PUBLISHED_FIELDS: FieldName[] = [
  'surface', 'rock', 'soil', 'sand', 'ash', 'snow', 'ice', 'lava', 'water', 'flowX', 'flowY', 'flowZ',
  'temperature', 'moisture', 'humidity', 'wetness', 'fertility', 'salinity',
  'grass', 'shrub', 'tree', 'crop', 'grassSpecies', 'treeSpecies', 'shrubSpecies', 'cropSpecies',
  'fire', 'burnt', 'road', 'biome', 'cloud', 'precip', 'precipType', 'ore', 'oreType', 'territory',
  'pollution', 'blight', 'radiation', 'windX', 'windY', 'windZ', 'aquifer',
];

/** fields that change quickly (sent at most every ~100 ms); everything else is slow (~500 ms) */
export const FAST_FIELDS: ReadonlySet<FieldName> = new Set<FieldName>([
  'water', 'flowX', 'flowY', 'flowZ', 'fire', 'lava', 'cloud', 'precip', 'precipType', 'snow', 'wetness', 'ice', 'surface', 'sand',
  'windX', 'windY', 'windZ', 'burnt', 'ash',
]);

export interface PlanetFields {
  surface: Float32Array; rock: Float32Array; soil: Float32Array; sand: Float32Array; ash: Float32Array;
  snow: Float32Array; ice: Float32Array; lava: Float32Array; water: Float64Array;
  flowX: Float32Array; flowY: Float32Array; flowZ: Float32Array;
  temperature: Float32Array; moisture: Float32Array; humidity: Float32Array; wetness: Float32Array;
  fertility: Float32Array; salinity: Float32Array;
  grass: Float32Array; shrub: Float32Array; tree: Float32Array; crop: Float32Array;
  grassSpecies: Float32Array; treeSpecies: Float32Array; shrubSpecies: Float32Array; cropSpecies: Float32Array;
  fire: Float32Array; burnt: Float32Array; road: Float32Array; biome: Float32Array; cloud: Float32Array;
  precip: Float32Array; precipType: Float32Array; ore: Float32Array; oreType: Float32Array; territory: Float32Array;
  pollution: Float32Array; blight: Float32Array; radiation: Float32Array;
  windX: Float32Array; windY: Float32Array; windZ: Float32Array; aquifer: Float32Array;
}

/** Solver state (saved, hashed; not shipped as fields). */
export interface PlanetSolverState {
  /** water outflow per directed edge, m³ per hydrology step */
  flux: Float64Array;
  /** hydrology active flag / consecutive quiet steps */
  hAct: Uint8Array;
  hQuiet: Uint8Array;
  /** connected-sea mask and its shoreline */
  ocean: Uint8Array;
  coast: Uint8Array;
  /** floating ice on wet cells (m, not part of surface; not mass) */
  seaIce: Float32Array;
  /** fire / talus / lava / sand active flags */
  fAct: Uint8Array;
  tAct: Uint8Array;
  lAct: Uint8Array;
  /** weather-system overlay of the last weather step: mask, precip mm/h, precip type, cloud, temperature delta */
  wMask: Uint8Array;
  wPrecip: Float32Array;
  wType: Uint8Array;
  wCloud: Float32Array;
  wTemp: Float32Array;
  /** prevailing (climate) wind, before weather systems */
  baseWindX: Float32Array;
  baseWindY: Float32Array;
  baseWindZ: Float32Array;
  /** sea-level potential temperature (°C) — the climate energy state; temperature = tPot − lapse × altitude */
  tPot: Float32Array;
  /** slow means for plants and biomes: temperature (°C, ~3 days), light (0..1, ~1 day), precipitation (mm/h, ~4 days) */
  tempMean: Float32Array;
  lightMean: Float32Array;
  precipMean: Float32Array;
  /** the climate plants and biomes live by: temperature (°C) and light (0..1) averaged over about a year (fix pass:
   * plants judged by a 3-day mean died back every winter of a 12-day year and never recovered their cover) */
  tempYear: Float32Array;
  lightYear: Float32Array;
  /** the year's extremes (°C): the hottest and the coldest hour of about the last year — envelopes of the hourly
   * temperature that relax toward tempYear (~3 years) — what a people choosing a home must live through
   * (settlement.ts seasonTemps) */
  tHi: Float32Array;
  tLo: Float32Array;
  /** climate steps the year-scale memory has run since it was last reset (a world given air or moved: the memory of
   * its old climate is dropped and re-learned as a growing-window mean, not over years) */
  climMem: Float32Array;
  /** painted biome pins (-1 none) */
  pinnedBiome: Int8Array;
  /** climate-only precipitation (mm/h) and cloud cover, before weather systems are layered on */
  cPrecip: Float32Array;
  cCloud: Float32Array;
  /** aquifer seepage onto the surface (m per hydrology step), recomputed by the slow hydrology pass */
  seep: Float32Array;
}

export interface Spring {
  id: number;
  cell: number;
  /** m³ per hydrology step */
  rate: number;
  /** ticks left (-1 = permanent) */
  life: number;
}

export interface Vent {
  id: number;
  cell: number;
  /** metres of lava per terrain step at the vent */
  rate: number;
  life: number;
}

export interface WeatherSystem {
  id: number;
  kind: number;
  /** unit vector (body frame) */
  pos: [number, number, number];
  /** body-frame tangent velocity, unit-vector delta per tick */
  vel: [number, number, number];
  radius: number;
  intensity: number;
  /** ticks remaining (-1 = until cleared) */
  life: number;
  age: number;
  maxLife: number;
  pinned: boolean;
}

/** Base (stored) planet parameters; PlanetParams for snapshots is derived from these + the tick. */
export interface PlanetState {
  radius: number;
  gravity: number;
  dayHours: number;
  axialTilt: number;
  sunFrozen: boolean;
  seasonPinned: number | null;
  seaLevel: number;
  magnetism: number;
  atmosphere: AtmosphereParams;
  orbit: OrbitParams;
  cloudiness: number;
  globalWeather: string | null;
  kind: string;
  /** render palette hint (planetkinds render) */
  render: string;
  climateOffset: number;
  /** spin anchor: angle spin0 at tick spinTick0 */
  spin0: number;
  spinTick0: number;
  /** eclipse / aerosol light multiplier hook (1 = clear) */
  lightScale: number;
  /** liquid of the seas */
  liquid: { id: string; freeze: number; boil: number };
  /** how wet the land starts (planet kind moisture; 1 = Earth-like) */
  moistureBias?: number;
  /** mean ground height at generation: the altitude datum for the lapse rate on worlds whose sea lies below it */
  refLevel?: number;
  /** (SIM phase 4) a ring of rubble around it (a cracked world): radii from the centre (m) and density 0..1 */
  ring?: { inner: number; outer: number; density: number };
}

/** Tunable rates (exposed through the parameter registry; tests switch sinks off). */
export interface PlanetConfig {
  rainScale: number;
  evaporation: number;
  infiltration: number;
  oceanRelax: boolean;
  erosion: number;
  freeze: boolean;
  fireSpread: number;
  vegGrowth: number;
  sandTransport: number;
  lavaCooling: number;
  weatherSpawn: number;
}

export function defaultConfig(): PlanetConfig {
  return {
    rainScale: 3, evaporation: 1, infiltration: 1, oceanRelax: true, erosion: 1, freeze: true, fireSpread: 1,
    vegGrowth: 1, sandTransport: 1, lavaCooling: 1, weatherSpawn: 1,
  };
}

/** Hydrology scalar state. */
export interface HydroState {
  /** current sea level the ocean relaxes toward (ramps toward st.seaLevel) */
  seaNow: number;
  /** sea level used for the current ocean mask */
  maskLevel: number;
  /** hydrology steps taken */
  steps: number;
  /** ocean cell count (mask) */
  oceanCells: number;
  /** explicit sources (+) and sinks (−) since creation, m³ (for conservation accounting) */
  sourced: number;
  /** request a mask recompute at the next hydrology step */
  maskDirty: boolean;
  /** the deepest cell of the last non-empty sea: where a sea drained away and poured again comes back (computeOcean) */
  seedCell?: number;
  /** erosion not yet published to snapshots: upper bound on any cell's ground change since the last bump (m) */
  erodeAcc?: number;
}

export type PlanetRngs = { hydro: Rng; fire: Rng; weather: Rng; climate: Rng; veg: Rng; terrain: Rng; people: Rng };

export class Planet {
  readonly id: number;
  name: string;
  readonly seed: number;
  readonly n: number;
  readonly grid: IcoGrid;
  readonly geo: GridGeo;
  readonly noise: Noise3;
  readonly count: number;
  /** cell areas in m² (Float64 for exact volume bookkeeping) */
  readonly cellArea: Float64Array;
  /** mean edge length in metres */
  readonly edgeM: number;
  st: PlanetState;
  cfg: PlanetConfig;
  f: PlanetFields;
  s: PlanetSolverState;
  hydro: HydroState;
  weather: WeatherSystem[] = [];
  springs: Spring[] = [];
  vents: Vent[] = [];
  /** first-time chronicle triggers: key -> tick */
  firsts: Record<string, number> = {};
  /** peoples: agents, buildings, settlements, herds, ground items (CONTRACT §6.4, §8) */
  people: PeopleState;
  rng: PlanetRngs;
  alive = true;
  /** monotonically bumped per field when it changes (global stamp from the universe) */
  fieldVer: Record<string, number> = {};
  /** set by the universe so bump() can stamp versions */
  stamp: () => number = () => 0;
  /** total vegetation cover after the last vegetation pass (saved: the vegetation pass skips lifeless worlds) */
  vegTotal = 0;
  /** something planted / painted since the last vegetation pass (saved) */
  vegDirty = false;
  /** transient generation output (drainage accumulation) consumed by hydrology init; never saved */
  genAcc: Float32Array | null = null;
  /** derived ground-function source (CONTRACT §4.3), rebuilt lazily when `surface` changes; never saved or hashed */
  private groundCache: { rev: number; surface: Float32Array; src: GroundSource } | null = null;
  /** counts every real change of `surface` (updSurface): the ground cache keys on it rather than on the snapshot field
   * version, because some systems publish small changes late (erosion) — the sim must always see the live ground.
   * Transient: a loaded sim starts at 0 with an empty cache, which recomputes from the same arrays. */
  private surfRev = 0;
  /** transient per-tick scratch (never saved) */
  readonly scratch: {
    dV: Float64Array; edge: Float64Array; lastDv: Float64Array; list: Int32Array; list2: Int32Array; cells: number[];
    mark: Uint32Array; markStamp: number;
  };

  constructor(id: number, name: string, seed: number, n: number, st: PlanetState) {
    this.id = id;
    this.name = name;
    this.seed = seed >>> 0;
    this.n = n;
    this.grid = getGrid(n);
    this.geo = getGeo(n);
    this.noise = new Noise3(this.seed);
    this.count = this.grid.count;
    this.st = st;
    this.cfg = defaultConfig();
    const N = this.count;
    const E = this.grid.nbr.length;
    const R = st.radius;
    this.cellArea = new Float64Array(N);
    for (let c = 0; c < N; c++) this.cellArea[c] = this.grid.area[c] * R * R;
    this.edgeM = this.grid.meanEdgeAngle * R;
    const F = () => new Float32Array(N);
    this.f = {
      surface: F(), rock: F(), soil: F(), sand: F(), ash: F(), snow: F(), ice: F(), lava: F(), water: new Float64Array(N),
      flowX: F(), flowY: F(), flowZ: F(), temperature: F(), moisture: F(), humidity: F(), wetness: F(), fertility: F(),
      salinity: F(), grass: F(), shrub: F(), tree: F(), crop: F(), grassSpecies: F().fill(-1), treeSpecies: F().fill(-1),
      shrubSpecies: F().fill(-1), cropSpecies: F().fill(-1), fire: F(), burnt: F(), road: F(), biome: F(), cloud: F(),
      precip: F(), precipType: F(), ore: F(), oreType: F(), territory: F().fill(-1), pollution: F(), blight: F(),
      radiation: F(), windX: F(), windY: F(), windZ: F(), aquifer: F(),
    };
    this.s = {
      flux: new Float64Array(E), hAct: new Uint8Array(N), hQuiet: new Uint8Array(N), ocean: new Uint8Array(N),
      coast: new Uint8Array(N), seaIce: F(), fAct: new Uint8Array(N), tAct: new Uint8Array(N), lAct: new Uint8Array(N),
      wMask: new Uint8Array(N), wPrecip: F(), wType: new Uint8Array(N), wCloud: F(), wTemp: F(),
      baseWindX: F(), baseWindY: F(), baseWindZ: F(), tPot: F(), tempMean: F(), lightMean: F(), precipMean: F(), tempYear: F(), lightYear: F(), tHi: F(), tLo: F(), climMem: F().fill(CLIM_MEM_FULL),
      pinnedBiome: new Int8Array(N).fill(-1), cPrecip: F(), cCloud: F(), seep: F(),
    };
    this.hydro = { seaNow: st.seaLevel, maskLevel: st.seaLevel, steps: 0, oceanCells: 0, sourced: 0, maskDirty: true };
    const root = new Rng(this.seed ^ 0x6e7e5);
    this.rng = {
      hydro: root.fork('hydro'), fire: root.fork('fire'), weather: root.fork('weather'), climate: root.fork('climate'),
      veg: root.fork('veg'), terrain: root.fork('terrain'), people: root.fork('people'),
    };
    this.people = new PeopleState(N, 8, 8);
    this.scratch = {
      dV: new Float64Array(N), edge: new Float64Array(E), lastDv: new Float64Array(N), list: new Int32Array(N), list2: new Int32Array(N),
      cells: [], mark: new Uint32Array(N), markStamp: 0,
    };
  }

  get radius(): number {
    return this.st.radius;
  }

  /** mark a field changed (snapshot versioning) */
  bump(f: FieldName): void {
    this.fieldVer[f] = this.stamp();
  }

  /** recompute surface for one cell from its layers */
  updSurface(c: number): void {
    const f = this.f;
    let s = f.rock[c] + f.soil[c] + f.sand[c] + f.ash[c] + f.snow[c];
    // ground ice counts; ice on a wet cell is floating (seaIce) and stored separately
    s += f.ice[c];
    const v = Math.fround(s);
    if (f.surface[c] !== v) {
      f.surface[c] = v;
      this.surfRev++;
    }
  }

  updAllSurface(): void {
    for (let c = 0; c < this.count; c++) this.updSurface(c);
    this.bump('surface');
  }

  /** elevation above the current sea level (m) */
  alt(c: number): number {
    return this.f.surface[c] - this.st.seaLevel;
  }

  /**
   * The ground function's source for this world (src/sim/grid/surface.ts groundHeight / groundOffset): the live field
   * arrays plus the per-cell curvature gradients, recomputed only when `surface` has changed since the last call. The
   * renderer computes the same gradients from the same snapshot arrays, so the sim's ground and the drawn ground agree.
   */
  ground(): GroundSource {
    const rev = this.surfRev;
    const gc = this.groundCache;
    if (gc && gc.rev === rev && gc.surface === this.f.surface) {
      gc.src.soil = this.f.soil; gc.src.sand = this.f.sand; gc.src.snow = this.f.snow;
      return gc.src;
    }
    const grad = surfaceGradients(this.grid, this.st.radius, this.f.surface, gc?.src.grad as Float32Array | undefined);
    const src: GroundSource = {
      grid: this.grid, radius: this.st.radius, noise: this.noise,
      surface: this.f.surface, soil: this.f.soil, sand: this.f.sand, snow: this.f.snow, grad,
    };
    this.groundCache = { rev, surface: this.f.surface, src };
    return src;
  }

  /** the cell nearest a unit vector */
  cellAt(p: ArrayLike<number>): number {
    return this.grid.nearestCell(p[0], p[1], p[2]);
  }

  /** cells within `radiusM` metres of unit vector p (reuses a scratch array; copy if you keep it) */
  cellsNear(p: ArrayLike<number>, radiusM: number): number[] {
    const ang = Math.max(radiusM / this.st.radius, this.grid.meanEdgeAngle * 0.5);
    return this.grid.cellsWithin(p[0], p[1], p[2], ang, this.scratch.cells);
  }

  /** a fresh visit stamp for "visited" marks in scratch.mark */
  nextMark(): number {
    const s = this.scratch;
    s.markStamp = (s.markStamp + 1) >>> 0;
    if (s.markStamp === 0) { s.mark.fill(0); s.markStamp = 1; }
    return s.markStamp;
  }

  /** total liquid volume on the surface (m³) */
  waterVolume(): number {
    let v = 0;
    const w = this.f.water, a = this.cellArea;
    for (let c = 0; c < this.count; c++) v += w[c] * a[c];
    return v;
  }

  /** planet params as the renderer sees them at `tick` (derived calendar filled in), from Universe.sun at that tick:
   * the star's longitude (hour), the rotation and the body-frame sun the sim heats by */
  paramsAt(tick: number, sun: { lon: number; spin: number; dir: ArrayLike<number> }): PlanetParams {
    const st = this.st;
    const spin = sun.spin;
    const sunLon = sun.lon;
    const sunDir = sun.dir;
    const yearDays = Math.max(1e-3, st.orbit.period / (st.dayHours * 60));
    const yf = yearFraction(st.orbit, tick);
    let hour = 12 + ((spin - sunLon) / (Math.PI * 2)) * 24;
    hour = ((hour % 24) + 24) % 24;
    return {
      radius: st.radius,
      gravity: st.gravity,
      dayHours: st.dayHours,
      axialTilt: st.axialTilt,
      spin,
      sunFrozen: st.sunFrozen,
      seasonPinned: st.seasonPinned,
      seaLevel: st.seaLevel,
      magnetism: st.magnetism,
      atmosphere: { ...st.atmosphere, tint: st.atmosphere.tint ? [st.atmosphere.tint[0], st.atmosphere.tint[1], st.atmosphere.tint[2]] : null },
      orbit: { ...st.orbit },
      cloudiness: st.cloudiness,
      globalWeather: st.globalWeather,
      kind: st.render,
      year: 1 + orbitCount(st.orbit, tick),
      dayOfYear: Math.min(Math.floor(yearDays) , Math.floor(yf * yearDays)),
      yearDays: Math.round(yearDays * 100) / 100,
      hourAtLon0: (hour / 24) * st.dayHours,
      sunDir: [sunDir[0], sunDir[1], sunDir[2]],
      ...(st.ring ? { ring: { ...st.ring } } : {}),
    };
  }

  /** calendar for chronicle dates */
  calendar(tick: number): { year: number; day: number } {
    const yearDays = Math.max(1e-3, this.st.orbit.period / (this.st.dayHours * 60));
    return { year: 1 + orbitCount(this.st.orbit, tick), day: 1 + Math.floor(yearFraction(this.st.orbit, tick) * yearDays) };
  }

  /** has air at all (weather, rain, wind, fire need it) */
  get airy(): boolean {
    return this.st.atmosphere.pressure >= 0.02;
  }
}

/** Every saved/hashed typed array of a planet, in a fixed order. */
export function planetArrays(p: Planet): [string, TypedArray][] {
  const out: [string, TypedArray][] = [];
  for (const k of Object.keys(p.f).sort()) out.push([`f.${k}`, (p.f as unknown as Record<string, TypedArray>)[k]]);
  for (const k of Object.keys(p.s).sort()) out.push([`s.${k}`, (p.s as unknown as Record<string, TypedArray>)[k]]);
  for (const [k, a] of p.people.agents.arrays()) out.push([`a.${k}`, a]);
  return out;
}

export interface PlanetJson {
  id: number;
  name: string;
  seed: number;
  n: number;
  st: PlanetState;
  cfg: PlanetConfig;
  hydro: HydroState;
  weather: WeatherSystem[];
  springs: Spring[];
  vents: Vent[];
  firsts: Record<string, number>;
  rng: Record<string, RngState>;
  alive: boolean;
  fieldVer: Record<string, number>;
  vegTotal?: number;
  vegDirty?: boolean;
  people?: PeopleJson;
}

export function planetToJson(p: Planet): PlanetJson {
  const rng: Record<string, RngState> = {};
  // unsigned words: Rng keeps signed int32 internally after some steps and unsigned after load() — same bits, but
  // the saved (and hashed) form must be canonical
  for (const k of Object.keys(p.rng).sort()) rng[k] = (p.rng as Record<string, Rng>)[k].save().map((x) => x >>> 0) as RngState;
  return {
    id: p.id, name: p.name, seed: p.seed, n: p.n,
    st: JSON.parse(JSON.stringify(p.st)) as PlanetState,
    cfg: { ...p.cfg }, hydro: { ...p.hydro },
    weather: p.weather.map((w) => ({ ...w, pos: [...w.pos] as [number, number, number], vel: [...w.vel] as [number, number, number] })),
    springs: p.springs.map((s) => ({ ...s })), vents: p.vents.map((v) => ({ ...v })),
    firsts: { ...p.firsts }, rng, alive: p.alive, fieldVer: { ...p.fieldVer }, vegTotal: p.vegTotal, vegDirty: p.vegDirty,
    people: p.people.toJson(),
  };
}

export function planetFromJson(j: PlanetJson, arrays: Map<string, TypedArray>): Planet {
  const p = new Planet(j.id, j.name, j.seed, j.n, j.st);
  p.cfg = { ...defaultConfig(), ...j.cfg };
  p.hydro = { ...j.hydro };
  p.weather = j.weather.map((w) => ({ ...w }));
  p.springs = j.springs.map((s) => ({ ...s }));
  p.vents = (j.vents ?? []).map((v) => ({ ...v }));
  p.firsts = { ...j.firsts };
  for (const k of Object.keys(j.rng)) (p.rng as Record<string, Rng>)[k]?.load(j.rng[k]);
  p.alive = j.alive;
  p.fieldVer = { ...j.fieldVer };
  p.vegTotal = j.vegTotal ?? 0;
  p.vegDirty = j.vegDirty ?? true;
  // the agent store must exist at its saved capacity before its arrays are filled
  p.people = PeopleState.fromJson(j.people, p.count, null);
  for (const [name, arr] of planetArrays(p)) {
    const src = arrays.get(`p${p.id}.${name}`);
    if (!src) continue; // a field added in a later minor version keeps its fresh default
    if (src.length !== arr.length) throw new Error(`save: planet ${p.id} array '${name}' has ${src.length} entries, expected ${arr.length}`);
    (arr as unknown as { set(a: ArrayLike<number>): void }).set(src as unknown as ArrayLike<number>);
  }
  // saves from before the yearly climate means: start them from the short means
  if (!arrays.has(`p${p.id}.s.tempYear`)) { p.s.tempYear.set(p.s.tempMean); p.s.lightYear.set(p.s.lightMean); }
  if (!arrays.has(`p${p.id}.s.tHi`)) for (let c = 0; c < p.count; c++) { p.s.tHi[c] = p.s.tempMean[c] + 12; p.s.tLo[c] = p.s.tempMean[c] - 12; }
  if (!arrays.has(`p${p.id}.s.climMem`)) p.s.climMem.fill(CLIM_MEM_FULL);
  // transient people indices are rebuilt by the universe once it knows the tick (sim.ts universeFromHeader)
  return p;
}

// ───────────────────────────── creation ─────────────────────────────

export interface PlanetSpec {
  id: number;
  name: string;
  seed: number;
  kind: string;
  orbit: OrbitParams;
  /** overrides of the kind's defaults (n, radius, gravity, dayHours, axialTilt (deg), magnetism, climateOffset,
   * vegetation, oceanFraction, atmosphere: {...}, cloudiness) */
  overrides?: Record<string, unknown>;
}

const DEG = Math.PI / 180;

/** Resolve a kind + overrides into a PlanetKindDef copy. */
export function resolveKind(content: Content, kind: string, overrides?: Record<string, unknown>): PlanetKindDef {
  const base = content.planetkinds.get(kind);
  const def = JSON.parse(JSON.stringify(base)) as PlanetKindDef;
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) continue;
      if ((k === 'atmosphere' || k === 'relief' || k === 'surface' || k === 'liquid') && v && typeof v === 'object') {
        Object.assign((def as unknown as Record<string, object>)[k], v);
      } else (def as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return def;
}

/** Build and generate a planet (geology, seas, materials, ores). Climate / life / biomes are initialised by the
 * universe afterwards (they need the star and orbit). */
export function generatePlanet(content: Content, spec: PlanetSpec): { planet: Planet; def: PlanetKindDef } {
  const def = resolveKind(content, spec.kind, spec.overrides);
  const st: PlanetState = {
    radius: def.radius,
    gravity: def.gravity,
    dayHours: def.dayHours,
    axialTilt: def.axialTilt * DEG,
    sunFrozen: false,
    seasonPinned: null,
    seaLevel: 0,
    magnetism: def.magnetism,
    atmosphere: { ...def.atmosphere, tint: def.atmosphere.tint ? [...def.atmosphere.tint] as [number, number, number] : null },
    orbit: { ...spec.orbit },
    cloudiness: def.cloudiness,
    globalWeather: null,
    kind: def.id,
    render: def.render,
    climateOffset: def.climateOffset,
    spin0: 0,
    spinTick0: 0,
    lightScale: 1,
    liquid: { ...def.liquid },
    moistureBias: def.moisture ?? 1,
  };
  const p = new Planet(spec.id, spec.name, spec.seed, Math.round(def.n), st);
  p.people = new PeopleState(p.count, recipeTable(content).kw, 64);
  p.people.contentRef = content;
  generateRelief(p, def, content);
  return { planet: p, def };
}

function generateRelief(p: Planet, def: PlanetKindDef, content: Content): void {
  const g = p.grid;
  const N = p.count;
  const P = g.pos;
  const nz = p.noise;
  const R = def.relief;
  const rng = new Rng(p.seed ^ 0x9e11ef);
  const f = p.f;
  const h = new Float32Array(N);
  const radius = p.st.radius;
  const scaleM = radius / 3000; // relief amplitudes in the data are tuned for a 3 km world
  const craterMask = new Uint8Array(N);
  const volcanic = new Uint8Array(N);
  const cells: number[] = [];
  const hasSea = def.oceanFraction > 0;

  // 1. macro relief
  const cont = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const s = R.continentScale;
    cont[c] = nz.warped(x * s + 3.1, y * s, z * s - 1.7, 0.75, 5) + 0.12 * nz.fbm(x * 3.2, y * 3.2, z * 3.2, 3);
  }
  if (hasSea) {
    const theta = quantile(cont, def.oceanFraction);
    let hi = -Infinity, lo = Infinity;
    for (let c = 0; c < N; c++) { if (cont[c] > hi) hi = cont[c]; if (cont[c] < lo) lo = cont[c]; }
    const landSpan = Math.max(1e-3, hi - theta);
    const seaSpan = Math.max(1e-3, theta - lo);
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      const v = cont[c] - theta;
      let e: number;
      if (v > 0) {
        const land = Math.min(1, (v / landSpan) * 1.6);
        const belt = smoothstep(0.05, 0.45, nz.fbm(x * 1.6 + 9.3, y * 1.6 - 2.2, z * 1.6 + 4.4, 3) + 0.15);
        const rs = R.ridgeScale;
        const ridge = nz.ridged(x * rs + 1.1, y * rs, z * rs - 5.3, 4);
        const hills = nz.fbm(x * 6.5, y * 6.5 + 7.7, z * 6.5, 3);
        e = 3 + R.continents * Math.pow(land, 1.25) + R.hills * hills * smoothstep(0.0, 0.2, land)
          + R.ridges * belt * Math.pow(ridge, 2.2) * smoothstep(0.02, 0.22, land);
      } else {
        const sd = Math.min(1, -v / seaSpan * 1.4);
        e = -(3 + 22 * smoothstep(0.0, 0.06, sd) + 95 * smoothstep(0.05, 0.35, sd) + 40 * nz.fbm(x * 4, y * 4, z * 4, 2) * smoothstep(0.1, 0.4, sd) + 30 * sd);
      }
      h[c] = e;
    }
  } else {
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      const rs = R.ridgeScale;
      h[c] = R.continents * cont[c] + R.ridges * Math.pow(nz.ridged(x * rs, y * rs, z * rs, 4), 2)
        + R.hills * nz.fbm(x * 6.5, y * 6.5 + 7.7, z * 6.5, 3);
    }
  }

  // 2. impact history: old craters, then maria (younger basalt floods), then young craters
  const nCraters = Math.round((R.craters * N) / 1000);
  const dir = [0, 0, 0];
  const craterAt = () => {
    randomDir(rng, dir);
    const ang = R.craterMax * Math.pow(rng.float(), 2.6) + g.meanEdgeAngle * 1.3;
    stampCrater(g, h, dir[0], dir[1], dir[2], ang, radius, craterMask, 0.19, cells);
  };
  const oldCraters = Math.round(nCraters * 0.6);
  for (let i = 0; i < oldCraters; i++) craterAt();
  const maria = new Float32Array(N);
  if (R.maria > 0) {
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      const m = nz.fbm(x * 1.1 + 7, y * 1.1, z * 1.1 - 3, 3);
      const k = smoothstep(0.1, 0.28, m) * R.maria;
      maria[c] = k;
      // basalt floods: flatten to a smooth low level
      h[c] = h[c] * (1 - 0.85 * k) - 30 * k;
      // highlands: rugged where no maria
      if (R.highlands > 0) h[c] += R.highlands * (1 - k) * (0.4 + 0.6 * (0.5 + 0.5 * nz.fbm(x * 4.2 + 2, y * 4.2, z * 4.2, 3)));
    }
  }
  for (let i = oldCraters; i < nCraters; i++) craterAt();

  // 3. volcanoes (cones with calderas); active vents on volcanic worlds
  const summits: number[] = [];
  for (let i = 0; i < R.volcanoes; i++) {
    let best = -1;
    // prefer land for the cone
    for (let tries = 0; tries < 12; tries++) {
      randomDir(rng, dir);
      const c = g.nearestCell(dir[0], dir[1], dir[2]);
      if (!hasSea || h[c] > 10 || tries === 11) { best = c; break; }
    }
    const ang = (0.08 + rng.float() * 0.12) * (3000 / radius) ** 0.2;
    const height = (160 + rng.float() * 260) * scaleM;
    const s = stampVolcano(g, h, P[best * 3], P[best * 3 + 1], P[best * 3 + 2], ang, height, cells);
    for (const c of cells) volcanic[c] = 1;
    let top = s;
    for (const c of cells) if (h[c] > h[top]) top = c;
    summits.push(top);
  }

  // 4. desert features: terraced mesas and canyons
  if (R.mesas > 0 || R.canyons > 0) {
    for (let c = 0; c < N; c++) {
      const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
      if (R.mesas > 0) {
        const mesa = nz.fbm(x * 3.3 + 5, y * 3.3, z * 3.3, 3);
        if (mesa > 0.15 && h[c] > 5) {
          const k = smoothstep(0.15, 0.25, mesa) * R.mesas;
          const terr = Math.floor((h[c] + 160) / 28) * 28 - 160;
          h[c] = h[c] * (1 - k) + (terr + 55) * k;
        }
      }
      if (R.canyons > 0 && h[c] > 0) h[c] -= R.canyons * Math.pow(nz.ridged(x * 4.5 + 2, y * 4.5, z * 4.5, 3), 6);
    }
  }

  // scale relief for the planet's size (data amplitudes are for 3 km worlds)
  if (scaleM !== 1) for (let c = 0; c < N; c++) h[c] *= scaleM;

  // relax cell-scale noise: the fractal octaves near the grid spacing make 45° steps between neighbours, which no
  // soil, river or road could sit on. A few Laplacian passes keep the shapes and kill the jaggies (craters already
  // have their own smooth profiles, so airless worlds get a single light pass).
  const passes = hasSea ? 3 : 1;
  const tmpS = new Float32Array(N);
  for (let pass = 0; pass < passes; pass++) {
    for (let c = 0; c < N; c++) {
      let sum = 0, k = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { sum += h[g.nbr[e]]; k++; }
      tmpS[c] = h[c] * 0.45 + (sum / k) * 0.55;
    }
    h.set(tmpS);
  }

  // 5. fluvial carving: drainage-area incision gives dendritic valleys (wet worlds only)
  const cellM = p.edgeM;
  const carve = def.atmosphere.pressure > 0.05 && hasSea ? Math.round(R.carve) : 0;
  for (let pass = 0; pass < carve; pass++) {
    const filled = priorityFlood(g, h, 0);
    const rcv = receivers(g, filled, 0);
    const acc = accumulate(sortDescending(filled), rcv);
    for (let c = 0; c < N; c++) {
      if (h[c] <= 0.5) continue;
      const r = rcv[c];
      if (r < 0) continue;
      const slope = Math.max(0, (filled[c] - filled[r]) / cellM);
      const cut = Math.min(14, 2.2 * Math.sqrt(acc[c]) * Math.min(1.2, slope * 6 + 0.15));
      h[c] = Math.max(0.6, h[c] - cut * 0.5);
    }
    const tmp = Float32Array.from(h);
    for (let c = 0; c < N; c++) {
      if (h[c] <= 0) continue;
      let s = 0, k = 0;
      for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) { s += h[g.nbr[e]]; k++; }
      tmp[c] = h[c] * 0.8 + (s / k) * 0.2;
      if (tmp[c] < 0.6 && h[c] > 0) tmp[c] = 0.6;
    }
    h.set(tmp);
  }

  // 6. sea level: 0 for worlds with seas; below the lowest point otherwise (so the slider starts dry)
  let hMin = Infinity, hMax = -Infinity;
  for (let c = 0; c < N; c++) { if (h[c] < hMin) hMin = h[c]; if (h[c] > hMax) hMax = h[c]; }
  p.st.seaLevel = hasSea ? 0 : Math.floor(hMin - 5);
  let hSum = 0;
  for (let c = 0; c < N; c++) hSum += h[c];
  p.st.refLevel = hasSea ? 0 : hSum / N;
  p.hydro.seaNow = p.st.seaLevel;
  p.hydro.maskLevel = p.st.seaLevel;

  // drainage for rivers / ores / lakes (consumed by hydrology init)
  const sea = p.st.seaLevel;
  const filled = priorityFlood(g, h, hasSea ? sea : -Infinity);
  const rcv = receivers(g, filled, hasSea ? sea : -Infinity);
  const acc = accumulate(sortDescending(filled), rcv);
  p.genAcc = acc;
  const oceanDist = distanceFrom(g, (c) => hasSea && h[c] < sea, 64);

  // 7. materials
  const slope = new Float32Array(N);
  for (let c = 0; c < N; c++) {
    let m = 0;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) m = Math.max(m, Math.abs(h[g.nbr[e]] - h[c]));
    slope[c] = m / cellM;
  }
  const S = def.surface;
  const airy = def.atmosphere.pressure > 0.05;
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const lat = g.lat[c];
    const sl = Math.abs(Math.sin(lat));
    const alt = h[c] - sea;
    const land = !hasSea || h[c] >= sea;
    // rough climate guess for materials (the climate model takes over at once)
    const tEst = 28 - 50 * Math.pow(sl, 1.35) - 0.06 * Math.max(0, alt) + def.climateOffset;
    const mEst = Math.max(0, Math.min(1, 0.45 + 0.3 * Math.cos(6 * lat) * 0.5 + 0.4 * Math.exp(-oceanDist[c] / 9) - 0.25 + 0.2 * nz.fbm(x * 3 - 4, y * 3, z * 3 + 2, 3)));
    let soil = 0, sand = 0, ash = 0, ice = 0;
    if (S.regolith > 0) {
      // airless dust blanket: thick on flats, thin on crater walls; darker basalt dust on maria
      sand = Math.max(0.04, S.regolith * (1.15 - slope[c] * 2.5)) * (0.75 + 0.5 * hashFloat(c, p.seed, 11));
      ash = 0.3 * maria[c];
    }
    if (land && airy) {
      // soil thins on steep ground (rock shows on cliffs) and in the cold
      soil = S.soil * smoothstep(1.4, 0.2, slope[c]) * (0.4 + mEst) / 1.2 * (tEst > -6 ? 1 : 0.35);
      if (hasSea && oceanDist[c] <= 2 && alt < 7 && slope[c] < 0.18) sand = Math.max(sand, (0.9 + 0.8 * hashFloat(c, p.seed, 3)) * Math.min(1.5, S.sand));
      if (mEst < 0.3 && tEst > 10) sand = Math.max(sand, (0.3 - mEst) * 9 * S.sand / 3 * (0.6 + 0.8 * nz.ridged(x * 18, y * 18, z * 18, 2)));
      if (R.dunes > 0 && mEst < 0.4) sand = Math.max(sand, S.sand * (0.4 + R.dunes * 0.25 * nz.ridged(x * 22, y * 22 + 3, z * 22, 2)) * smoothstep(0.4, 0.1, mEst));
      if (S.iceCaps > 0) ice = S.iceCaps * smoothstep(0.88, 0.97, sl) * (0.6 + 0.8 * hashFloat(c, p.seed, 5));
    }
    if (volcanic[c] && S.ash > 0) ash = Math.max(ash, S.ash * (0.4 + 0.6 * hashFloat(c, p.seed, 9)));
    if (!land) { soil = hasSea ? 0.4 : 0; sand = hasSea ? 0.6 : sand; }
    sand = Math.min(sand, 8);
    f.soil[c] = soil;
    f.sand[c] = sand;
    f.ash[c] = ash;
    f.ice[c] = ice;
    f.rock[c] = h[c] - soil - sand - ash - ice;
    p.updSurface(c);
    f.salinity[c] = land ? 0 : 1;
  }

  // 8. lava vents in the calderas of active volcanoes (volcanic worlds keep them flowing)
  if (def.id === 'volcanic') {
    for (const s of summits) p.vents.push({ id: p.vents.length + 1, cell: s, rate: 0.35, life: -1 });
  }

  // 9. ores by geology
  const geoW = new Float32Array(7);
  const ores = content.ores.list;
  const basinDepth = priorityFlood(g, h, hasSea ? sea : -Infinity);
  const accMax = Math.max(1, quantile(acc, 0.995));
  for (let c = 0; c < N; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const alt = h[c] - sea;
    geoW[0] = smoothstep(100, 300, alt) + Math.min(1, slope[c] * 1.5); // mountain
    geoW[1] = volcanic[c] ? 1 : 0; // volcanic
    geoW[2] = (alt < 80 && slope[c] < 0.12 ? 0.8 : 0) + (alt < 0 && alt > -40 ? 0.5 : 0); // sedimentary
    geoW[3] = basinDepth[c] - h[c] > 0.5 ? 1 : 0; // basin
    geoW[4] = hasSea && oceanDist[c] >= 1 && oceanDist[c] <= 2 ? 1 : 0; // coast
    geoW[5] = craterMask[c] ? 1 : 0; // crater
    geoW[6] = alt > 0 ? smoothstep(0.02, 0.2, acc[c] / accMax) : 0; // river
    let best = 0, bestK = -1;
    for (let k = 0; k < ores.length; k++) {
      const o = ores[k];
      const gw = o.geology;
      const w = (gw.mountain ?? 0) * geoW[0] + (gw.volcanic ?? 0) * geoW[1] + (gw.sedimentary ?? 0) * geoW[2]
        + (gw.basin ?? 0) * geoW[3] + (gw.coast ?? 0) * geoW[4] + (gw.crater ?? 0) * geoW[5] + (gw.river ?? 0) * geoW[6];
      if (w <= 0) continue;
      const v = nz.noise(x * 9 + k * 17.3, y * 9 - k * 5.1, z * 9 + k * 2.7);
      const score = w * o.rarity * smoothstep(0.3, 0.75, v);
      if (score > best) { best = score; bestK = k; }
    }
    if (bestK >= 0 && best > 0.12) {
      f.ore[c] = Math.min(1, best);
      f.oreType[c] = bestK + 1;
    }
  }
}
