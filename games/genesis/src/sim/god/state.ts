// GENESIS — the god layer's state (CONTRACT.md §6.4, §11): everything the player (and rival gods) put into the world
// that is not a field, a person or a building — live disasters, the Touch (the hand) and what it holds, things in
// flight, the gods themselves (belief records, rivals), wards, the Called's standing orders, possession orders,
// restraint cooldowns, laws, the runtime content the freeform parser invented ("introduce chocolate"), and the
// relationship between the people and their god (LIVING.md §3: each settlement's record of the god's acts, its open
// prayers, its prophet and the prophecies, sacred places, the omens seen — `rel`).
//
// LIVING §3.5: the giant learning creature is gone from the game. Old saves drop its state on load (core/migrate15.ts
// and fromJson below); a held or thrown creature is let go of.
//
// Plain JSON objects only: the whole state is saved in the save header, hashed (determinism tests), restored by
// rewind, and walked in array order (ids ascending) so iteration never depends on timing.

import type { EntityRef, UnitVec } from '../types.ts';
import type { Building } from '../people/state.ts';
import type { ItemDef, RecipeDef, WeatherDef, SpeciesDef, OreDef, MaterialDef, PlantDef } from '../content.ts';
import type { RngState } from '../core/rng.ts';
import { Rng } from '../core/rng.ts';
import type { WindState, WindsOn } from './shaping.ts';

export type V3 = [number, number, number];

/** a live disaster (CONTRACT §11.3): composed of the effectors of its kind */
export interface DisasterState {
  id: number;
  kind: string;
  planet: number;
  pos: V3;
  /** unit-vector delta per tick (fronts, storms, a disaster being moved) */
  vel: V3;
  /** travel direction of a falling body (body frame, unit), for the renderer and the impact's ejecta */
  dir: V3;
  radius: number;
  intensity: number;
  /** player scale on top of the kind's defaults (disaster.scale) */
  scale: number;
  age: number;
  /** total life in ticks (-1 = until cancelled) */
  life: number;
  frozen: boolean;
  /** who caused it: 0 the player, 1.. rival gods, -1 nature */
  god: number;
  cause: string;
  seed: number;
  /** one-shot effectors already fired (indices) */
  fired: number[];
  /** effector scratch: originals of planet parameters a global effect changed, counters, kills ... (keys starting with a
   *  lower-case 'w' are the ids of weather systems it keeps; LIVING §3: 'Wr' its wrath, 'Wn' its warning ticks, 'bf' /
   *  'bt' / 'killed' its act's witness budget) */
  st: Record<string, number>;
  /** cells a spreading effector still burns / infects (spread frontier, ascending) */
  cells: number[];
  /** kind-specific render parameters (meteor altitude, tornado height, plume height ...) */
  params: Record<string, number>;
  /** a target body (a moon falling, a rogue world) or a target point */
  target: number;
  /** consequences tallied for the chronicle */
  dead: number;
  ruined: number;
}

/** what the hand holds or a projectile carries */
export type Payload =
  | { kind: 'agent'; id: number }
  | { kind: 'animal'; species: number; count: number; herd: number }
  | { kind: 'tree'; species: number }
  | { kind: 'rock'; mass: number }
  | { kind: 'item'; item: number; qty: number; artifact: boolean }
  | { kind: 'building'; b: Building };

export interface HandState {
  god: number;
  planet: number;
  pos: V3;
  /** metres above the ground */
  alt: number;
  held: Payload | null;
  /** 'open' | 'grab' | 'point' | 'slap' | 'stroke' | 'cast' */
  pose: string;
  /** the pose falls back to open / grab at this tick */
  poseUntil: number;
  /** the last place the hand was moved from (a release with no explicit velocity flings along the motion) */
  prev: V3;
  prevTick: number;
}

/** something thrown (or falling) through the air of a planet: ballistic on the sphere under its gravity */
export interface ProjectileState {
  id: number;
  planet: number;
  /** position: unit vector (body frame) + metres above the datum sphere surface (radius) */
  pos: V3;
  alt: number;
  /** velocity, m/s, body frame */
  vel: V3;
  payload: Payload;
  god: number;
  t0: number;
  /** where it was let go (fear near, awe far is judged from the landing) */
  from: V3;
  /** LIVING §3.1: the act it belongs to when a disaster lifted it ('d<id>'): its landing is part of that act */
  src?: string;
}

export interface GodRecord {
  id: number;
  name: string;
  /** 'visitor': the sky-folk of another world, worshipped by a people they came down among (space/contact.ts) */
  kind: 'player' | 'rival' | 'visitor';
  /** -1 cruel .. +1 good: the running balance of help against harm (the hand's tint, the rival's choices) */
  alignment: number;
  /** rivals: 'benevolent' | 'wrathful' | 'trickster' | 'jealous' */
  temperament: string;
  home: { planet: number; settlement: number };
  nextAct: number;
  acts: number;
  help: number;
  harm: number;
  wonder: number;
  color: number;
  alive: boolean;
  /** LIVING §3.6: a rival's epithet ("the Undertow"): `name` + ' ' + epithet is how the chronicle names it */
  epithet?: string;
}

export interface ShieldState {
  id: number;
  planet: number;
  pos: V3;
  radius: number;
  until: number;
  god: number;
}

/** a standing order of one of the Called (LIVING §3.6: the god's chosen followers — the mechanic of the old disciples) */
export interface DiscipleOrder {
  agent: number;
  planet: number;
  god: number;
  /** 'worship' | 'farm' | 'build' | 'teach' | 'preach' | 'missionary' */
  mode: string;
  /** missionary: the settlement to convert (-1 none) */
  target: number;
  since: number;
  converted: number;
}

/** the player drives an agent: a queue of orders (walk somewhere, do something) */
export interface PossessionState {
  agent: number;
  planet: number;
  god: number;
  orders: { kind: 'move' | 'act'; pos: V3 | null; act: string; target: number }[];
}

// ───────────────────────────── the people and their god (LIVING.md §3) ─────────────────────────────

/** one act of a god on a settlement, as the settlement remembers it (the last 12; LIVING §3.1) */
export interface ActRecord {
  /** 'help' | 'harm' | 'wonder' | 'mercy' | 'sign' | an omen kind */
  kind: string;
  tick: number;
  god: number;
  /** members it killed */
  dead: number;
  /** a prophet warned of it, or an omen came within 2 days before */
  foretold: boolean;
  /** a taboo broken, the Called or the prophet attacked: they read it as earned */
  provoked: boolean;
  /** the act it was (records of one act — a disaster's whole life — are merged) */
  key?: string;
}

/** a request a settlement makes of its god (LIVING §3.3) */
export interface Prayer {
  id: number;
  /** 'food' | 'rain' | 'healing' | 'warmth' | 'protection' | 'rebuilding' */
  kind: string;
  since: number;
  /** the answer window ends */
  until: number;
  /** 0..1 how pressing (the UI's icon size) */
  urgency: number;
  god: number;
}

/** a prophecy: the god (through a prophet) or the prophet commits to an act in a window (LIVING §3.4.3) */
export interface Prophecy {
  id: number;
  /** 'rain' | 'food' | 'healing' | 'warmth' | 'protection' | 'rebuilding' | 'harm' | 'sign' */
  kind: string;
  planet: number;
  settlement: number;
  /** the prophet who spoke it (agent id) */
  agent: number;
  from: number;
  until: number;
  /** 'god' (prophet.foretell: the god commits itself) | 'prophet' (their own reading of a prayer or an omen) */
  by: string;
}

/** a prophet (LIVING §3.4): an ordinary grown person who speaks for the god */
export interface ProphetState {
  agent: number;
  planet: number;
  settlement: number;
  /** 0..1: how far the people believe them */
  credibility: number;
  since: number;
  /** 'called' (by the god) | 'risen' (on their own, after a wonder) */
  how: string;
  /** a risen prophet waits on the god's next act: confirmed (+0.2) or discredited */
  confirmed: boolean;
  fulfilled: number;
  failed: number;
  /** no preaching until this tick (persecution: silenced) */
  silenced: number;
  /** 0 none, 1 silenced, 2 exiled, 3 killed (the persecution's stage) */
  persecution: number;
  /** last persecution act (tick, -1 none) */
  persecutedAt: number;
  /** the god turned from them (prophet.abandon) */
  abandoned: boolean;
  /** carrying the faith: a town of their people to preach in until a tick (-1 none) */
  journey: { target: number; until: number } | null;
  /** the shrine they founded (building id, -1 none) */
  shrine: number;
  /** the last omen they read (tick) */
  readAt: number;
  /** the god answered the last persecution (a ward over them, a blow at the ruler) */
  defended?: boolean;
  /** the god stayed silent after the last persecution (credibility paid once) */
  unheard?: boolean;
  /** the tick a harm they foretold came (the ruler's blame) */
  harmCame?: number;
  /** their name (the chronicle names them after death) */
  name?: string;
}

/** a sacred place (LIVING §3.4.5): a spring, a grove, a peak, a site (a crater where nobody died, a martyr's place) */
export interface SacredPlace {
  id: number;
  planet: number;
  cell: number;
  pos: V3;
  /** 'spring' | 'grove' | 'mountain' | 'site' */
  kind: string;
  /** the settlement that keeps it (-1 none) */
  settlement: number;
  since: number;
  /** who made it sacred: 'god' | 'prophet' | 'omen' | 'martyr' */
  by: string;
  /** what it was when it became sacred (the harm check): water depth, tree cover, height */
  was: number;
}

/** what a settlement holds of its god (keyed "<planet>:<settlement>") */
export interface SettlementRel {
  /** the last 12 acts of a god on it, oldest first */
  acts: ActRecord[];
  prayers: Prayer[];
  /** prayers that lapsed in a row (three: "they say the god is deaf") */
  lapses: number;
  /** member means toward the player god: faith, fear, trust, loyalty (daily) */
  means: [number, number, number, number];
  /** omen kind -> the tick it was last seen here (an omen is an omen only after 10 quiet days) */
  omens: Record<string, number>;
  /** an evacuation in force: walk out to this point until the tick (precursors) */
  evacuate: { pos: V3; radius: number; until: number; disaster: number } | null;
  /** the sacred animal (animal id, '' none) */
  animal: string;
  /** daily memory of the conditions: tick a condition first held (drought, cold, ...), prayers raised throttle */
  since: Record<string, number>;
  /** this evening's worship: the tick its window opened and who has gone (agent ids) — once an evening each */
  vespers?: { t: number; went: number[] };
  /** (fix r4 #14) this morning's devotion: the tick its window opened and who has prayed (agent ids) — once a morning each */
  matins?: { t: number; went: number[] };
}

export interface RelState {
  st: Record<string, SettlementRel>;
  prophets: ProphetState[];
  prophecies: Prophecy[];
  places: SacredPlace[];
  /** the omens of the last days (newest last, at most 24): what was seen, where, by which settlements */
  omens: { kind: string; planet: number; pos: V3; tick: number; god: number; settlements: number[]; seen: number }[];
  /** id counter for prayers, prophecies and places */
  next: number;
  /** tallies (worship by source, prayers answered ...) for probes and the inspector */
  stats: Record<string, number>;
}

export function emptyRel(): RelState {
  return { st: {}, prophets: [], prophecies: [], places: [], omens: [], next: 1, stats: {} };
}

/** content made at runtime (freeform inventions, species laws): rebuilt into the content as the 'runtime' pack */
export interface RuntimeContent {
  items: ItemDef[];
  recipes: RecipeDef[];
  weather: WeatherDef[];
  /** species id -> parameter overrides (species.<id>.<param> laws) */
  species: Record<string, Partial<SpeciesDef>>;
  /** weather id -> animal species id it rains (a planet-derived species name) */
  rains: Record<string, string>;
  /**
   * LIVING CONTENT (god/materials.ts, god/plantsrt.ts): deposit kinds, building materials and plants the god made
   * (absent until the first: saves before them load as they were), the building types that take an invented material
   * (building id -> material ids put first in its list), and what each invented material made (its items, recipes, ore,
   * plant, uses: queries, chronicle firsts)
   */
  ores?: OreDef[];
  materials?: MaterialDef[];
  plants?: PlantDef[];
  buildingMats?: Record<string, string[]>;
  made?: Record<string, MadeMaterial>;
}

/** LIVING CONTENT: what one invented material made (god/materials.ts) */
export interface MadeMaterial {
  name: string;
  kind: string;
  traits: string[];
  uses: string[];
  /** the raw item (as it comes out of the ground or off the plant), the worked item, the item it is built with */
  raw: string;
  worked: string;
  build?: string;
  /** items it is made into (tools, blades, ornaments) */
  goods: string[];
  recipes: string[];
  ore?: string;
  plant?: string;
  material?: string;
  /** tick it was made */
  tick: number;
}

export interface GodJson {
  hands: HandState[];
  disasters: DisasterState[];
  projectiles: ProjectileState[];
  gods: GodRecord[];
  shields: ShieldState[];
  disciples: DiscipleOrder[];
  possession: PossessionState[];
  cooldowns: Record<string, number>;
  runtime: RuntimeContent;
  laws: Record<string, number>;
  settlementLaws: Record<string, string[]>;
  lastGod: Record<string, number>;
  rng: RngState;
  speedRequest: number;
  stats: Record<string, number>;
  /** god-held winds (god/shaping.ts) and what of them is laid on each world's base wind ("<planet>" -> winds) */
  winds?: WindState[];
  windsOn?: Record<string, WindsOn>;
  /** LIVING §3: the people and their god (absent in saves before 1.5) */
  rel?: RelState;
}

export function emptyRuntime(): RuntimeContent {
  return { items: [], recipes: [], weather: [], species: {}, rains: {} };
}

/** default per-universe god laws (param registry: god.*, disasters.*, belief.*) */
export function defaultLaws(): Record<string, number> {
  return {
    'disasters.natural': 1,
    'disasters.harm': 1,
    'belief.gain': 1,
    'belief.decay': 1,
    // LIVING §3.7: how hard the god's harm falls (0 gentle .. 1 total); survivable by default
    'god.wrath': 0.3,
    'hand.strength': 1,
    'rivals.activity': 1,
    'restraint.costScale': 1,
    'miracles.potency': 1,
  };
}

export class GodState {
  hands: HandState[] = [];
  disasters: DisasterState[] = [];
  projectiles: ProjectileState[] = [];
  gods: GodRecord[] = [playerGod()];
  shields: ShieldState[] = [];
  disciples: DiscipleOrder[] = [];
  possession: PossessionState[] = [];
  /** restraint cooldowns: "<god>:<power>" -> tick it is ready again */
  cooldowns: Record<string, number> = {};
  runtime: RuntimeContent = emptyRuntime();
  laws: Record<string, number> = defaultLaws();
  /** "<planet>:<settlement>" -> laws the god gave it */
  settlementLaws: Record<string, string[]> = {};
  /** "<planet>:<settlement>" -> dominant god last seen (conversions are chronicled when it changes) */
  lastGod: Record<string, number> = {};
  rng = new Rng(0x60d);
  /** a speed the god asked for (time.speed); the host (worker) applies it */
  speedRequest = -1;
  stats: Record<string, number> = {};
  /** god-held winds (weather.wind) and the winds currently laid on each world's base wind (god/shaping.ts) */
  winds: WindState[] = [];
  windsOn: Record<string, WindsOn> = {};
  /** LIVING §3: the people and their god — records, prayers, prophets, prophecies, sacred places, omens */
  rel: RelState = emptyRel();
  /** transient: witness tally at the start of a command (auto-witness), the command in flight */
  witnessMark = 0;

  toJson(): GodJson {
    return JSON.parse(JSON.stringify({
      hands: this.hands, disasters: this.disasters, projectiles: this.projectiles, gods: this.gods,
      shields: this.shields, disciples: this.disciples, possession: this.possession, cooldowns: sortKeys(this.cooldowns),
      runtime: this.runtime, laws: sortKeys(this.laws), settlementLaws: sortKeys(this.settlementLaws), lastGod: sortKeys(this.lastGod),
      rng: this.rng.save().map((x) => x >>> 0), speedRequest: this.speedRequest, stats: sortKeys(this.stats),
      winds: this.winds, windsOn: sortKeys(this.windsOn), rel: { ...this.rel, st: sortKeys(this.rel.st), stats: sortKeys(this.rel.stats) },
    })) as GodJson;
  }

  static fromJson(j: Partial<GodJson> | undefined): GodState {
    const g = new GodState();
    if (!j) return g;
    const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    // (LIVING §3.5: a creature in an old save is gone — let go of by the hand, dropped from the air)
    g.hands = copy(j.hands ?? []).map((h) => ((h.held as { kind: string } | null)?.kind === 'creature' ? { ...h, held: null, pose: 'open' } : h));
    g.disasters = copy(j.disasters ?? []);
    g.projectiles = copy(j.projectiles ?? []).filter((pr) => (pr.payload as { kind: string }).kind !== 'creature');
    g.gods = copy(j.gods ?? [playerGod()]);
    g.shields = copy(j.shields ?? []);
    g.disciples = copy(j.disciples ?? []);
    g.possession = copy(j.possession ?? []);
    g.cooldowns = { ...(j.cooldowns ?? {}) };
    g.runtime = { ...emptyRuntime(), ...copy(j.runtime ?? emptyRuntime()) };
    g.laws = { ...defaultLaws(), ...(j.laws ?? {}) };
    for (const k of Object.keys(g.laws)) if (k.startsWith('creature.')) delete g.laws[k];
    g.settlementLaws = copy(j.settlementLaws ?? {});
    g.lastGod = { ...(j.lastGod ?? {}) };
    if (j.rng) g.rng.load(j.rng);
    g.speedRequest = j.speedRequest ?? -1;
    g.stats = { ...(j.stats ?? {}) };
    g.winds = copy(j.winds ?? []);
    g.windsOn = copy(j.windsOn ?? {});
    g.rel = { ...emptyRel(), ...copy(j.rel ?? emptyRel()) };
    return g;
  }

  god(id: number): GodRecord | undefined {
    for (const g of this.gods) if (g.id === id) return g;
    return undefined;
  }

  disaster(id: number): DisasterState | undefined {
    for (const d of this.disasters) if (d.id === id) return d;
    return undefined;
  }

  hand(god = 0): HandState | undefined {
    for (const h of this.hands) if (h.god === god) return h;
    return undefined;
  }

  law(k: string): number {
    const v = this.laws[k];
    return v === undefined ? 1 : v;
  }

  /** a law on one world: its own value ("<key>@<planet>") over the universe's */
  lawAt(k: string, planet: number): number {
    const v = this.laws[`${k}@${planet}`];
    return v === undefined ? this.law(k) : v;
  }

  stat(k: string, add = 1): void {
    this.stats[k] = (this.stats[k] ?? 0) + add;
  }

  /** is an entity held by any hand or in flight */
  isHeld(kind: EntityRef['kind'], id: number): boolean {
    for (const h of this.hands) if (h.held && h.held.kind === kind && payloadId(h.held) === id) return true;
    for (const p of this.projectiles) if (p.payload.kind === kind && payloadId(p.payload) === id) return true;
    return false;
  }
}

export function payloadId(p: Payload): number {
  switch (p.kind) {
    case 'agent': return p.id;
    case 'building': return p.b.id;
    case 'animal': return p.herd;
    default: return -1;
  }
}

export function playerGod(): GodRecord {
  return {
    id: 0, name: 'You', kind: 'player', alignment: 0, temperament: 'player', home: { planet: -1, settlement: -1 },
    nextAct: 0, acts: 0, help: 0, harm: 0, wonder: 0, color: 0xf2d38a, alive: true,
  };
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

export function v3(a: ArrayLike<number>): V3 {
  return [a[0], a[1], a[2]];
}

export function unit(a: ArrayLike<number>): V3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}

export type { UnitVec };
