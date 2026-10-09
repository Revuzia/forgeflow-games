// GENESIS — the god layer's state (CONTRACT.md §6.4, §11): everything the player (and rival gods) put into the world
// that is not a field, a person or a building — live disasters, the hand and what it holds, things in flight,
// creatures, the gods themselves (belief records, rivals), shields, disciples' orders, possession orders, restraint
// cooldowns, laws, and the runtime content the freeform parser invented ("introduce chocolate").
//
// Plain JSON objects only: the whole state is saved in the save header, hashed (determinism tests), restored by
// rewind, and walked in array order (ids ascending) so iteration never depends on timing.

import type { EntityRef, UnitVec } from '../types.ts';
import type { Building } from '../people/state.ts';
import type { ItemDef, RecipeDef, WeatherDef, SpeciesDef } from '../content.ts';
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
  /** effector scratch: originals of planet parameters a global effect changed, counters, kills ... */
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
  | { kind: 'building'; b: Building }
  | { kind: 'creature'; id: number };

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
}

export interface CreatureState {
  id: number;
  planet: number;
  name: string;
  template: string;
  /** owner: 0 the player, 1.. a rival, -1 a settlement's own */
  god: number;
  /** settlement that raised it (-1 the god's own) */
  settlement: number;
  pos: V3;
  /** movement segment (analytic between ticks, like agents) */
  from: V3;
  to: V3;
  t0: number;
  t1: number;
  heading: number;
  height: number;
  /** 0..1 grown */
  growth: number;
  alignment: number;
  hunger: number;
  energy: number;
  strength: number;
  intelligence: number;
  /** behaviour -> desire weight 0..1 (learned) */
  desires: Record<string, number>;
  /** miracle -> skill 0..1 (learned by watching the hand) */
  miracles: Record<string, number>;
  /** the behaviour it did last (what a slap or a stroke judges) */
  last: { kind: string; tick: number; target: number; obj: string };
  /** what it is doing now: behaviour, target, whether the act at the destination has happened */
  doing: { kind: string; until: number; target: number; obj: string; at: V3 | null; acted: boolean };
  /** the tick its hunger / energy / growth were last brought up to date */
  upd: number;
  leash: { mode: string; settlement: number; point: V3 | null; length: number } | null;
  activity: string;
  anim: number;
  held: Payload | null;
  /** trust in its god's hand (consent to be picked up) */
  trust: number;
  /** next think tick */
  next: number;
  born: number;
  /** behaviour counters (inspector) */
  counts: Record<string, number>;
  alive: boolean;
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
}

export interface ShieldState {
  id: number;
  planet: number;
  pos: V3;
  radius: number;
  until: number;
  god: number;
}

/** a disciple's standing order (CONTRACT §11.5 / Black & White's disciples) */
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

/** content made at runtime (freeform inventions, species laws): rebuilt into the content as the 'runtime' pack */
export interface RuntimeContent {
  items: ItemDef[];
  recipes: RecipeDef[];
  weather: WeatherDef[];
  /** species id -> parameter overrides (species.<id>.<param> laws) */
  species: Record<string, Partial<SpeciesDef>>;
  /** weather id -> animal species id it rains (a planet-derived species name) */
  rains: Record<string, string>;
}

export interface GodJson {
  hands: HandState[];
  creatures: CreatureState[];
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
    'creature.learning': 1,
    'creature.growth': 1,
    'hand.strength': 1,
    'rivals.activity': 1,
    'restraint.costScale': 1,
    'miracles.potency': 1,
  };
}

export class GodState {
  hands: HandState[] = [];
  creatures: CreatureState[] = [];
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
  /** transient: witness tally at the start of a command (auto-witness), the command in flight */
  witnessMark = 0;

  toJson(): GodJson {
    return JSON.parse(JSON.stringify({
      hands: this.hands, creatures: this.creatures, disasters: this.disasters, projectiles: this.projectiles, gods: this.gods,
      shields: this.shields, disciples: this.disciples, possession: this.possession, cooldowns: sortKeys(this.cooldowns),
      runtime: this.runtime, laws: sortKeys(this.laws), settlementLaws: sortKeys(this.settlementLaws), lastGod: sortKeys(this.lastGod),
      rng: this.rng.save().map((x) => x >>> 0), speedRequest: this.speedRequest, stats: sortKeys(this.stats),
      winds: this.winds, windsOn: sortKeys(this.windsOn),
    })) as GodJson;
  }

  static fromJson(j: Partial<GodJson> | undefined): GodState {
    const g = new GodState();
    if (!j) return g;
    const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    g.hands = copy(j.hands ?? []);
    g.creatures = copy(j.creatures ?? []);
    g.disasters = copy(j.disasters ?? []);
    g.projectiles = copy(j.projectiles ?? []);
    g.gods = copy(j.gods ?? [playerGod()]);
    g.shields = copy(j.shields ?? []);
    g.disciples = copy(j.disciples ?? []);
    g.possession = copy(j.possession ?? []);
    g.cooldowns = { ...(j.cooldowns ?? {}) };
    g.runtime = { ...emptyRuntime(), ...copy(j.runtime ?? emptyRuntime()) };
    g.laws = { ...defaultLaws(), ...(j.laws ?? {}) };
    g.settlementLaws = copy(j.settlementLaws ?? {});
    g.lastGod = { ...(j.lastGod ?? {}) };
    if (j.rng) g.rng.load(j.rng);
    g.speedRequest = j.speedRequest ?? -1;
    g.stats = { ...(j.stats ?? {}) };
    g.winds = copy(j.winds ?? []);
    g.windsOn = copy(j.windsOn ?? {});
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

  creature(id: number): CreatureState | undefined {
    for (const c of this.creatures) if (c.id === id) return c;
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
    case 'agent': case 'creature': return p.id;
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
