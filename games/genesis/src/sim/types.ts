// GENESIS — shared protocol types between the sim core (worker / Node) and the client (main thread).
//
// This file is the seam of CONTRACT.md §6 and §14. The sim never imports three.js or the DOM; the client never reaches
// into sim internals — it only sees Snapshots, SimEvents and CommandResults, and only sends Commands.
//
// Changes here are ADDITIVE by default (new optional fields, new FieldName members, new command kinds). A breaking
// change must update every consumer in the same change.

// ───────────────────────────────── time ─────────────────────────────────

/** 1 tick = 1 game minute. */
export const TICKS_PER_HOUR = 60;
/** At 1x the sim advances this many ticks per real second (a 24 h day = 144 s at 1x). */
export const TICKS_PER_SECOND_1X = 10;
/** Speed presets offered by the UI (multipliers of TICKS_PER_SECOND_1X). 0 = paused. */
export const SPEED_PRESETS = [0, 1, 10, 100, 1000] as const;

// ───────────────────────────────── refs ─────────────────────────────────

export type EntityKind =
  | 'agent' | 'animal' | 'building' | 'tree' | 'rock' | 'item' | 'creature' | 'settlement'
  | 'disaster' | 'weather' | 'ship' | 'planet' | 'moon' | 'star' | 'avatar' | 'cell';

/** A reference to anything the hand, the inspector or a command can point at. `planet` is the planet id. */
export interface EntityRef {
  kind: EntityKind;
  id: number;
  planet?: number;
}

/** A point on a planet: unit vector in the planet BODY frame (+Y north). */
export type UnitVec = [number, number, number];

// ─────────────────────────────── commands ───────────────────────────────

/**
 * Every player intervention is a Command (CONTRACT.md §11). `k` is the command kind, e.g. 'terrain.raise',
 * 'water.add', 'weather.paint', 'disaster.spawn', 'hand.grab', 'idea.teach', 'planet.set', 'freeform'.
 * Remaining keys are kind-specific parameters. Commands are applied at the next tick boundary, in arrival order, and
 * recorded in the command log (rewind / replay / determinism).
 */
export interface Command {
  k: string;
  [param: string]: unknown;
}

export interface CommandResult {
  ok: boolean;
  /** human-readable outcome, shown as a toast ("Rain begins over the Aru coast.") */
  msg?: string;
  /** for freeform: the commands it resolved to (shown in the "do this" preview) */
  resolved?: Command[];
  /** ids created (disasters, entities, worlds) so the UI can select / follow them */
  created?: EntityRef[];
  /** tick at which it was applied */
  tick?: number;
}

// ─────────────────────────────── events ─────────────────────────────────

/**
 * Something that happened inside a tick that the client should present (FX, sound, toast, chronicle).
 * `t` examples: 'impact', 'lightning', 'quake', 'eruption', 'birth', 'death', 'discovery', 'refusal', 'built',
 * 'collapsed', 'fire.start', 'launch', 'arrival', 'contact', 'chronicle', 'miracle', 'settlement.founded',
 * 'settlement.fallen', 'war', 'treaty', 'extinction', 'speciation', 'plague', 'gift', 'thrown', 'landed', ...
 */
export interface SimEvent {
  t: string;
  tick: number;
  planet?: number;
  pos?: UnitVec;
  /** generic magnitudes / ids, meaning per event type */
  a?: number;
  b?: number;
  ref?: EntityRef;
  text?: string;
  data?: Record<string, unknown>;
}

export interface ChronicleEntry {
  tick: number;
  planet: number;
  /** the planet's calendar year (1-based) and day of year when it happened */
  year: number;
  day: number;
  /** 'discovery' | 'disaster' | 'founding' | 'fall' | 'war' | 'treaty' | 'extinction' | 'contact' | 'orbit' | 'god' | 'golden-age' | 'dark-age' | 'diaspora' | ... */
  kind: string;
  text: string;
  /** importance 0..3 (3 = era-defining); the UI filters on it */
  weight: number;
  refs?: EntityRef[];
}

// ─────────────────────────────── fields ─────────────────────────────────

/**
 * Per-cell planet fields shipped to the client (CONTRACT.md §7). Units:
 *   heights / depths in metres; temperature °C; moisture, fertility, vegetation, fire, road, wetness, clouds 0..1.
 * `surface` = rock + soil + sand + ash + snow + ice + lavaCrust... i.e. the top of solid ground above the datum
 * sphere (planet.radius). Water surface = surface + water.
 */
export type FieldName =
  | 'surface' | 'rock' | 'soil' | 'sand' | 'ash' | 'snow' | 'ice' | 'lava' | 'water'
  | 'flowX' | 'flowY' | 'flowZ'           // water velocity (m/tick, body-frame tangent vector) for rivers / foam
  | 'temperature' | 'moisture' | 'humidity' | 'wetness' | 'fertility' | 'salinity'
  | 'grass' | 'shrub' | 'tree' | 'crop'   // vegetation cover 0..1
  | 'treeSpecies' | 'shrubSpecies' | 'cropSpecies' // dominant plant species index (content order), -1 none
  | 'fire' | 'burnt' | 'road' | 'biome' | 'cloud' | 'precip' | 'precipType'
  | 'ore' | 'oreType' | 'territory' | 'pollution' | 'blight' | 'radiation';

// ─────────────────────────────── snapshot ───────────────────────────────

export interface OrbitParams {
  /** parent body: -1 = the star, otherwise a planet id (moons) */
  parent: number;
  /** semi-major axis, metres */
  a: number;
  e: number;
  /** inclination (rad) */
  inc: number;
  /** mean anomaly at tick 0 (rad) */
  phase0: number;
  /** orbital period in ticks (= the planet's year) */
  period: number;
  /** longitude of ascending node (rad) */
  node: number;
}

export interface AtmosphereParams {
  /** surface pressure in atmospheres (0 = airless) */
  pressure: number;
  o2: number;
  co2: number;
  n2: number;
  methane: number;
  /** aerosol optical depth (dust, ash, impact winter) */
  dust: number;
  /** extra scattering tint override for "blood-red sky" etc.; null = physical */
  tint: [number, number, number] | null;
  /** acid / toxicity 0..1 */
  toxicity: number;
}

export interface PlanetParams {
  radius: number;
  gravity: number;
  /** hours per day (rotation period); 0 or Infinity is not allowed: use sunFrozen */
  dayHours: number;
  /** obliquity (rad) */
  axialTilt: number;
  /** current rotation angle (rad) at the snapshot tick — the client advances it by dayHours between snapshots */
  spin: number;
  sunFrozen: boolean;
  seasonPinned: number | null;
  seaLevel: number;
  magnetism: number;
  atmosphere: AtmosphereParams;
  orbit: OrbitParams;
  /** 0..1 global cloudiness bias; the cloud field carries the local detail */
  cloudiness: number;
  /** planet-wide weather override kind, or null */
  globalWeather: string | null;
  /** palette / material hints for exotic worlds (e.g. 'terran', 'barren', 'ice', 'desert', 'lava', 'gas') */
  kind: string;
  /** calendar */
  year: number;
  dayOfYear: number;
  yearDays: number;
  /** local solar hour at longitude 0, 0..24 */
  hourAtLon0: number;
}

/** Structure-of-arrays block of moving things (agents, animals). Positions are unit vectors on the planet. */
export interface MoverBlock {
  count: number;
  id: Uint32Array;
  /** content index of species (agents: species list; animals: animal list) */
  species: Uint16Array;
  /** 3 per entity: unit vector at snapshot tick */
  pos: Float32Array;
  /** 3 per entity: unit-vector delta per tick (for extrapolation) */
  vel: Float32Array;
  /** metres above the ground (flyers, thrown, swimmers < 0) */
  alt: Float32Array;
  /** heading (rad) in the local east/north tangent frame, 0 = north, + toward east */
  heading: Float32Array;
  /** animation state id (AnimState) */
  anim: Uint8Array;
  /** 0..1 animation phase seed / progress */
  phase: Float32Array;
  /** per-entity flags (AgentFlag / AnimalFlag) */
  flags: Uint16Array;
  /** item id carried / held tool (-1 none) */
  carry: Int16Array;
  /** settlement / herd / group id (-1 none) */
  group: Int32Array;
  /** body scale (age, caste, size trait) */
  scale: Float32Array;
  /** packed RGB tint (clothing / fur / caste colour) */
  tint: Uint32Array;
}

/** animation states shared by agents, animals and creatures */
export const AnimState = {
  idle: 0, walk: 1, run: 2, work: 3, carry: 4, pray: 5, sleep: 6, flee: 7, fight: 8, dance: 9, swim: 10,
  dead: 11, held: 12, thrown: 13, eat: 14, build: 15, chop: 16, dig: 17, fish: 18, teach: 19, sit: 20, cheer: 21,
  graze: 22, fly: 23, mourn: 24, sail: 25,
} as const;
export type AnimStateId = (typeof AnimState)[keyof typeof AnimState];

export const AgentFlag = {
  child: 1, elder: 2, female: 4, leader: 8, disciple: 16, possessed: 32, sick: 64, armed: 128,
  sleepingIndoors: 256, onFire: 512, priest: 1024, master: 2048, trader: 4096, soldier: 8192, sees_god: 16384,
} as const;

export interface BuildingBlock {
  count: number;
  id: Uint32Array;
  /** content index into buildings */
  type: Uint16Array;
  /** content index into materials ('thatch','hide','wood','mudbrick','stone','brick','timber','concrete','steel','glass', ...) */
  material: Uint8Array;
  /** culture style variant 0..7 (alignment and language drive it) */
  style: Uint8Array;
  pos: Float32Array;
  /** yaw around the local up (rad) */
  rot: Float32Array;
  /** footprint scale */
  scale: Float32Array;
  /** 0..1 construction progress (1 = complete) */
  progress: Float32Array;
  /** BuildingFlag bits */
  flags: Uint16Array;
  /** night light level 0..1 and light kind (0 none,1 hearth,2 oil,3 gas,4 electric) packed: kind*256 + level*255 */
  light: Uint16Array;
  settlement: Int32Array;
  /** 0..1 damage */
  damage: Float32Array;
}

export const BuildingFlag = { burning: 1, ruined: 2, abandoned: 4, sacred: 8, walled: 16, occupied: 32, working: 64, lit: 128 } as const;

export interface SettlementView {
  id: number;
  name: string;
  species: number;
  pos: UnitVec;
  population: number;
  /** individuals simulated as agents vs aggregated cohort members */
  agents: number;
  cohort: number;
  /** -1 cruel .. +1 benevolent culture alignment (from awe vs fear) */
  alignment: number;
  /** belief in the player god 0..1 and the dominant god id (-1 none, 0 player, >0 rivals) */
  belief: number;
  god: number;
  /** era label derived from knowledge ('stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space') */
  era: string;
  /** banner colour (packed RGB) */
  color: number;
  /** polity id (settlements can share a polity), -1 none */
  polity: number;
  /** language id (drifts on split) */
  language: number;
  /** 0..1 light emitted at night (hearths -> lamps -> electric) */
  nightLight: number;
  knowledgeCount: number;
  flags: number;
}

export interface CreatureView {
  id: number;
  planet: number;
  name: string;
  body: string;
  pos: UnitVec;
  heading: number;
  /** metres tall */
  height: number;
  /** -1 evil .. +1 good: drives the body morph */
  alignment: number;
  anim: AnimStateId;
  phase: number;
  /** what it is doing ("eating a sheep", "watering the fields of Aru") */
  activity: string;
  leash: number;
  held: EntityRef | null;
  hunger: number;
  energy: number;
  /** body morph parameters 0..1 (fat, strong, spiky, glow) */
  morph: [number, number, number, number];
}

export interface DisasterView {
  id: number;
  kind: string;
  planet: number;
  pos: UnitVec;
  /** metres */
  radius: number;
  intensity: number;
  /** 0..1 progress through its life; -1 = ongoing */
  progress: number;
  frozen: boolean;
  /** kind-specific render params (e.g. meteor altitude & direction, tornado height, plume height) */
  params: Record<string, number>;
}

export interface WeatherView {
  id: number;
  kind: string;
  planet: number;
  pos: UnitVec;
  radius: number;
  intensity: number;
  pinned: boolean;
  /** body-frame velocity, unit-vector delta per tick */
  vel: UnitVec;
}

export interface ShipView {
  id: number;
  kind: string; // 'raft','boat','sailship','airship','rocket','orbiter','generation-ship','gate'
  owner: number; // settlement id
  species: number;
  /** 'pad' | 'ascent' | 'orbit' | 'transfer' | 'descent' | 'landed' | 'sailing' | 'lost' */
  phase: string;
  /** planet the ship is on / around (-1 = interplanetary) */
  planet: number;
  /** if on/near a planet: body-frame unit vector + altitude; if interplanetary: system-frame metres */
  pos: [number, number, number];
  alt: number;
  /** system-frame position (metres) always provided, for the system view */
  sysPos: [number, number, number];
  heading: number;
  crew: number;
  from: number;
  to: number;
  progress: number;
}

export interface HandView {
  planet: number;
  pos: UnitVec;
  alt: number;
  held: EntityRef | null;
  /** 'open' | 'grab' | 'point' | 'slap' | 'stroke' | 'cast' */
  pose: string;
  alignment: number;
}

export interface PlanetSnap {
  id: number;
  name: string;
  /** grid frequency (IcoGrid n); the client builds the same grid */
  gridN: number;
  seed: number;
  params: PlanetParams;
  alive: boolean;
  /** field versions; a field array is present only when it changed since the last snapshot sent to this client */
  fieldVersion: number;
  fields?: Partial<Record<FieldName, Float32Array>>;
  agents?: MoverBlock;
  animals?: MoverBlock;
  buildings?: BuildingBlock;
  settlements?: SettlementView[];
  weather?: WeatherView[];
  disasters?: DisasterView[];
  /** population totals by species index */
  population?: number[];
}

export interface StarView {
  name: string;
  /** spectral class: 'O','B','A','F','G','K','M','white-dwarf','neutron','black-hole','binary' */
  kind: string;
  /** relative to the sun = 1 */
  luminosity: number;
  temperature: number;
  radius: number;
  color: [number, number, number];
  /** 0..1 flare activity (solar flare disaster) */
  activity: number;
}

export interface Snapshot {
  /** game tick (integer part = completed ticks; may carry a fraction for interpolation) */
  tick: number;
  /** current speed multiplier (0 = paused) and the measured achieved multiplier */
  speed: number;
  achievedSpeed: number;
  star: StarView;
  planets: PlanetSnap[];
  ships: ShipView[];
  creatures: CreatureView[];
  hand: HandView | null;
  events: SimEvent[];
  chronicle: ChronicleEntry[];
  /** names of loaded content packs */
  content: string[];
  /** sim timing for the perf HUD (ms per tick, avg) */
  msPerTick: number;
  /** restraint mode (attention / worship costs) */
  restraint: boolean;
  /** god stats: worship pool per god (0 = player) */
  worship: number[];
}

// ─────────────────────────────── worker protocol ───────────────────────────────

/** main -> worker */
export type ToWorker =
  | { type: 'init'; scenario: string; seed: number; options?: Record<string, unknown> }
  | { type: 'cmd'; id: number; cmd: Command }
  | { type: 'parse'; id: number; text: string }
  | { type: 'speed'; speed: number }
  | { type: 'step'; id: number; ticks: number }
  | { type: 'snapshot'; full?: boolean }
  | { type: 'save'; id: number }
  | { type: 'load'; id: number; data: ArrayBuffer }
  | { type: 'rewind'; id: number; tick: number }
  | { type: 'query'; id: number; q: string; args?: Record<string, unknown> }
  | { type: 'mod'; id: number; pack: unknown };

/** worker -> main */
export type FromWorker =
  | { type: 'ready'; content: string[] }
  | { type: 'snapshot'; snap: Snapshot }
  | { type: 'result'; id: number; result: CommandResult }
  | { type: 'parsed'; id: number; result: CommandResult }
  | { type: 'stepped'; id: number; tick: number }
  | { type: 'saved'; id: number; data: ArrayBuffer }
  | { type: 'loaded'; id: number; ok: boolean; msg?: string }
  | { type: 'answer'; id: number; data: unknown }
  | { type: 'error'; msg: string; stack?: string };
