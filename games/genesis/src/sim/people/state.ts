// GENESIS — the peoples state of one planet (CONTRACT.md §6.4, §8): the agent store, buildings, settlements (with
// households, stores, culture, fields, flow fields and resource caches), herds, items lying on the ground, and the
// transient indices rebuilt from them (time wheel, spatial buckets, buildings by cell).
//
// Determinism rules for this state:
//   * Everything that steers the future is SAVED: typed arrays in the AgentStore, objects here (toJson / fromJson).
//     Caches that steer decisions (settlement resource lists, flow fields) are recomputed at fixed ticks by the
//     settlement step and saved with the settlement, so a loaded game sees exactly what the live one saw.
//   * Transient indices (wheel, buckets, id maps) are rebuilt from saved state and queried in canonical (id) order.

import type { Content } from '../content.ts';
import { AgentStore, type AgentStoreJson } from './agents.ts';
import { TimeWheel } from '../core/timewheel.ts';
import { recipeTable } from '../recipes/recipes.ts';
import { CellBuckets, CellIndex } from '../grid/spatial.ts';

export interface Household {
  id: number;
  /** agent ids, ascending */
  members: number[];
  /** building id of the home (-1 none) */
  home: number;
}

export interface Story {
  tick: number;
  kind: string;
  text: string;
  weight: number;
}

export interface Culture {
  /** -1 cruel / fearful .. +1 benevolent (love vs fear of the gods) */
  alignment: number;
  /** recipe indices the culture refuses (taught by the god or not) */
  taboos: number[];
  /** notable events the settlement tells about (newest last, at most 16) */
  stories: Story[];
  /**
   * sacred things: the species' own ('river', 'sun') and those its stories made: 'animal:<id>' (never hunted),
   * 'item:<id>' (never worked), 'god:<n>', 'place:<cell>'
   */
  sacred: string[];
  /** 0 open .. 1 hidebound: refuses new ideas */
  conservatism: number;
  /** music mode index (audio): 0 ionian 1 dorian 2 phrygian 3 lydian 4 mixolydian 5 aeolian 6 locrian */
  mode: number;
  /** when a taboo was sworn (recipe index -> tick): generations later it may be forgotten */
  tabooSince?: Record<string, number>;
}

/** a party within a settlement (CONTRACT §8.5): whose voice carries in war, faith and new ideas */
export interface Faction {
  /** 'hawks' | 'doves' | 'devout' | 'doubters' | 'elders' | 'seekers' */
  kind: string;
  /** share of the adults leaning this way 0..1 */
  share: number;
  /** agent id of its loudest member (0 none) */
  voice: number;
}

/**
 * A group of agents on an errand away from home (CONTRACT §8.6): a trade caravan or boat, gift / tribute bearers, a
 * raiding party, a war band (army) laying siege, colonists. Members are real agents carrying real goods; the mission
 * only coordinates them (muster -> outbound -> at the target -> homeward).
 */
export interface Mission {
  id: number;
  kind: 'trade' | 'gift' | 'tribute' | 'raid' | 'war';
  from: number;
  to: number;
  /** agent ids (ascending) */
  members: number[];
  /** 0 muster, 1 outbound, 2 at the target, 3 homeward, 4 done */
  phase: number;
  t0: number;
  tPhase: number;
  /** by boat (the route crosses water) */
  sea: boolean;
  /** boat item index carried (-1 none) and how many */
  boat: number;
  boats: number;
  /** goods sent out and goods brought back (item, qty) */
  out: [number, number][];
  back: [number, number][];
  /** army strength at the last reckoning (raids / wars) */
  strength: number;
  /** days the target has been under siege (walls) */
  siege: number;
  /** outcome words for the chronicle */
  note: string;
  /** the route, cell by cell, from home to the target (A* by land, or by boat over the water) */
  path: number[];
  /** agent ids who finished their errand at the target */
  done: number[];
}

/** a polity: one or more settlements under one name (CONTRACT §8.6) */
export interface Polity {
  /** id of the settlement that founded it */
  id: number;
  name: string;
  capital: number;
  founded: number;
  /** polity it pays tribute to (-1 none) */
  overlord: number;
  color: number;
}

/** relations between two polities (a < b): opinions both ways, war and peace, treaties, grievances (CONTRACT §8.6) */
export interface Relation {
  a: number;
  b: number;
  /** a's opinion of b, b's of a (-1 hatred .. +1 friendship) */
  op: [number, number];
  /** tick the current war began (-1 at peace) */
  war: number;
  /** polity that declared the war, and why ('iron', 'hunger', 'faith', 'raids', 'land') */
  aggressor: number;
  cause: string;
  /** first contact tick */
  contact: number;
  /** rolling value of goods traded */
  trade: number;
  /** grievance of a against b, of b against a (raids, theft, killings) */
  grievance: [number, number];
  /** fighters lost by a, by b in the current war */
  casualties: [number, number];
  /** war score (+ favours a) */
  score: number;
  /** 'trade-pact' | 'alliance' | 'tribute:<payer polity>' */
  treaties: string[];
  /** no new war before this tick (after a peace) */
  truce: number;
  /** last battle / raid tick */
  last: number;
}

/** how two settlements reach each other (cached; saved because trade and war read it) */
export interface Route {
  land: boolean;
  sea: boolean;
  /** metres along the way */
  dist: number;
  tick: number;
}

/** an animal species born on this world (speciation): drawn as its root ancestor, named for its new home */
export interface DerivedAnimal {
  /** species index (content animals first, then these) */
  idx: number;
  def: import('../content.ts').AnimalDef;
  /** content index of the root ancestor (the renderer draws that body) */
  base: number;
  parent: number;
  born: number;
}

/** long-term ecology of a planet (CONTRACT §10) */
export interface EcoState {
  /** new herds drift in on a living world (off for closed-world experiments) */
  immigration: boolean;
  /** species index -> first tick herds of it lived here */
  seen: Record<string, number>;
  /** species index -> tick it died out here */
  extinct: Record<string, number>;
  /** species index -> peak head count */
  peak: Record<string, number>;
  /** species index -> the species its last herd became (speciation, not extinction) */
  became?: Record<string, number>;
}

export interface Cohort {
  /** members beyond the individual cap: [children, adults, elders] */
  n: [number, number, number];
  /** fraction of cohort adults knowing each recipe (recipe index as key) */
  know: Record<string, number>;
  /** mean skill 0..1 */
  skill: number;
  /**
   * an epidemic among the cohort (SEIR fractions of its members; CONTRACT §10 plagues): disease index, exposed,
   * infectious, recovered (immune) shares; null when well
   */
  sick?: { d: number; e: number; i: number; r: number } | null;
}

/** resource cache of a settlement (recomputed at fixed ticks, saved) */
export interface ResourceCache {
  tick: number;
  /** gather item index -> best cells (descending availability) */
  items: Record<string, number[]>;
  /** fresh drinking water cells nearest first */
  water: number[];
  /** fishing cells */
  fish: number[];
  /** fertile free cells for new fields */
  fertile: number[];
  /** a predator herd within reach (-1 none) */
  danger: number;
  /** a dune / sand cell (accident triggers) */
  dune: number;
  /** contexts present around the settlement (string list) */
  contexts: string[];
}

/** a flow field toward the settlement centre over its territory (saved) */
export interface FlowField {
  tick: number;
  /** cells covered (ascending) and the next hop toward the centre for each (-1 at the centre) */
  cells: number[];
  next: number[];
  /** travel cost (seconds-ish) from each cell to the centre */
  cost: number[];
}

export interface Settlement {
  id: number;
  name: string;
  species: number;
  cell: number;
  pos: [number, number, number];
  /** founding tick; -1 while it is still a wandering band */
  founded: number;
  band: boolean;
  leader: number;
  parent: number;
  feature: string;
  language: number;
  langSeed: number;
  color: number;
  polity: number;
  /** tick it fell (-1 standing) */
  fallen: number;
  store: number[];
  households: Household[];
  culture: Culture;
  /** hoarded recipe indices (taught only within a household) */
  secrets: number[];
  /** recipe indices written in this settlement's books (cached from its buildings) */
  written: number[];
  /** recipe indices the settlement knows: living members ∪ written (if it can read) ∪ cohort */
  library: number[];
  era: number;
  /** farmed cells */
  fields: number[];
  /** plant index of its domesticated crop (-1 none yet) */
  crop: number;
  /** building ids under construction */
  sites: number[];
  /** band destination (unit vector) while migrating */
  target: [number, number, number] | null;
  /** territory radius, metres */
  territory: number;
  cohort: Cohort;
  res: ResourceCache | null;
  flow: FlowField | null;
  stats: { births: number; deaths: number; starved: number; froze: number; peak: number; discoveries: number; lost: number };
  relations: Record<string, number>;
  /** first buildings of each type (chronicle) */
  firsts: Record<string, number>;
  /** mean love and fear toward the player god (cached hourly) */
  belief: number;
  fearGod: number;
  nightLight: number;
  /** tick of the last discovery / famine / plague notices (throttles) */
  lastFamine: number;
  /** recent trigger events at this settlement: trigger -> tick */
  recent: Record<string, number>;
  /** items introduced by the god (refusal memory) */
  gifts: number;
  /** contexts explorers have seen beyond the territory (feeds experiments) */
  seen: string[];
  /** craft jobs for this hour: recipe, how many, where (saved: decisions read it) */
  jobs: { k: number; n: number; cell: number; building: number }[];
  /** items gatherers should bring (demand, most wanted first) */
  wants: number[];
  /** role quotas this hour */
  quota: number[];
  /** worship generated for each god (later phases spend it) */
  worship: number;
  /**
   * where recipes can be worked this hour (recipe index -> [cell, building] or [] for nowhere); cleared each hour.
   * Saved: decisions read it, so a loaded game must see the very same places.
   */
  places?: { hour: number; at: Record<string, number[]> };
  // ───── societies (CONTRACT §8.5, §8.6, §8.8) ─────
  /** parties within the settlement (daily) */
  factions: Faction[];
  /** dominant god (0 the player, 1.. rivals; -1 none: they believe in no god) and mean love per god (daily) */
  god: number;
  faith: number[];
  /** language lineage: seeds from the root tongue down to this settlement's own (language distance) */
  langLine: number[];
  /** settlements met (first contact), ascending ids */
  contacts: number[];
  /** golden / dark age: '' | 'golden' | 'dark', since when, and the daily history [knowledge, population, prosperity] */
  age: { kind: string; since: number; hist: number[][] };
  /** boat journeys made from here (ports emerge from boat use) */
  boatUse: number;
  /** rolling value of goods traded (decays daily) */
  traded: number;
  /** war mission besieging it (-1 none) */
  besieged: number;
  /** tick the current leader took office */
  leaderSince: number;
  /** worship generated per god since founding (CONTRACT §8.8) */
  worshipBy: number[];
}

/** fill the society fields of a settlement saved before they existed (and of fresh objects built elsewhere) */
export function normaliseSettlement(st: Settlement): Settlement {
  const s = st as Partial<Settlement> & Settlement;
  s.factions ??= [];
  s.god ??= -1;
  s.faith ??= [0, 0, 0, 0];
  s.langLine ??= [st.langSeed];
  s.contacts ??= [];
  s.age ??= { kind: '', since: -1, hist: [] };
  s.boatUse ??= 0;
  s.traded ??= 0;
  s.besieged ??= -1;
  s.leaderSince ??= st.founded;
  s.worshipBy ??= [st.worship ?? 0, 0, 0, 0];
  s.culture.tabooSince ??= {};
  s.cohort.sick ??= null;
  return s;
}

export interface Building {
  id: number;
  type: number;
  material: number;
  style: number;
  pos: [number, number, number];
  cell: number;
  rot: number;
  scale: number;
  /** 0..1 construction progress */
  progress: number;
  /** material units delivered to the site so far */
  delivered: number;
  /** 0..1 damage */
  damage: number;
  settlement: number;
  /** BuildingFlag bits */
  flags: number;
  /** knowledge written into this building (recipe indices) */
  books: number[];
  built: number;
  /** fire fuel in ticks (hearths, kilns, furnaces); 0 = out */
  fuel: number;
  /** people inside now (sleeping, working) */
  occupants: number;
  /** household that lives here (-1) */
  household: number;
}

export interface Herd {
  id: number;
  species: number;
  count: number;
  /** movement segment like agents (analytic between ticks) */
  from: [number, number, number];
  to: [number, number, number];
  t0: number;
  t1: number;
  cell: number;
  /** 0 graze, 1 move, 2 flee, 3 rest, 4 penned */
  state: number;
  /** settlement that keeps it (domestic), -1 wild */
  owner: number;
  /** 0..1 how hungry (starving herds shrink) */
  hunger: number;
  /** tick it was last hunted / scared */
  scared: number;
  // ───── ecology (CONTRACT §10) ─────
  /** seasonal migration target cell (-1 none) */
  goal?: number;
  /** days spent cut off from every other herd of its kind (isolation drives speciation) */
  iso?: number;
  /** accumulated divergence from its species (>= 1: a new species may arise) */
  drift?: number;
  /** running mean temperature of where it lives (°C): what it adapts to */
  envT?: number;
  /** a disease among the animals (disease index, -1 none) */
  sick?: number;
  /** invasive until this tick (arrived by ship / the god's hand: breeds fast, no enemies yet) */
  inv?: number;
}

export interface GroundItem {
  id: number;
  item: number;
  qty: number;
  pos: [number, number, number];
  cell: number;
  tick: number;
  /** dropped by the god / fallen from the sky: a thing to wonder at (reverse engineering) */
  artifact: boolean;
}

export interface PeopleJson {
  agents: AgentStoreJson;
  buildings: Building[];
  settlements: Settlement[];
  herds: Herd[];
  items: GroundItem[];
  names: Record<string, string>;
  /** per-species population of cohorts, persisted for snapshots */
  version: number;
  /** hourly herd spawning accumulator etc. */
  herdClock: number;
  missions?: Mission[];
  polities?: Polity[];
  relations?: Relation[];
  routes?: Record<string, Route>;
  species?: DerivedAnimal[];
  eco?: EcoState;
  blight?: number[];
  worship?: number[];
  firsts?: Record<string, number>;
  pending?: { sid: number; kind: string; mag: number; god: number }[];
}

const NO_BUILDINGS: readonly Building[] = Object.freeze([]) as readonly Building[];

export class PeopleState {
  agents: AgentStore;
  buildings: Building[] = [];
  settlements: Settlement[] = [];
  herds: Herd[] = [];
  items: GroundItem[] = [];
  /** custom names given by the god (agent id -> name) */
  names: Record<string, string> = {};
  /** bumped whenever buildings / settlements change (snapshot hint; not hashed) */
  version = 0;
  herdClock = 0;
  /** caravans, war bands, gift and tribute bearers away from home */
  missions: Mission[] = [];
  /** polities (by id) and the relations between them (sorted by a, b) */
  polities: Polity[] = [];
  relations: Relation[] = [];
  /** settlement pair "a:b" (a < b) -> how they reach each other */
  routes: Record<string, Route> = {};
  /** animal species born on this world */
  species: DerivedAnimal[] = [];
  eco: EcoState = { immigration: true, seen: {}, extinct: {}, peak: {} };
  /** cells where blight is active (ascending) */
  blight: number[] = [];
  /** worship generated on this world per god (0 = the player); later phases spend it */
  worship: number[] = [0, 0, 0, 0];
  /** world-level firsts of the peoples (first contact, first war, first port...) -> tick */
  firsts: Record<string, number> = {};
  /** god acts witnessed since the last step, waiting to be read by the settlements that saw them (chronicle) */
  pending: { sid: number; kind: string; mag: number; god: number }[] = [];
  /** the tick the peoples system is at (transient: set by every step and command; hooks without a universe read it) */
  now = 0;

  // ───── transient (rebuilt) ─────
  wheel: TimeWheel;
  /** cell -> agent slots */
  buckets: CellBuckets;
  /** building id -> index in `buildings` */
  bIndex = new Map<number, number>();
  /** cell -> building ids (ascending) */
  bByCell = new CellIndex();
  /** cell -> ground item ids (ascending) */
  iByCell = new CellIndex();
  /** settlement id -> index */
  sIndex = new Map<number, number>();
  /** settlement id -> member slots (ascending agent id) */
  members = new Map<number, number[]>();
  /** herds by id */
  hIndex = new Map<number, number>();
  /** reusable sun cache */
  sunTick = -1;
  sunDir: [number, number, number] = [0, 1, 0];
  sunRate = 0;
  sunRateHour = -1;
  sunLon = 0;
  /** the sun at the current hour's start and end (canonical samples; a tick between them interpolates) */
  sunA: [number, number, number] = [0, 1, 0];
  sunB: [number, number, number] = [0, 1, 0];
  /** queued chronicle-level notices raised during the tick (flushed by people.ts) */
  dirty = true;
  /** diagnostics (transient, never saved or hashed): agent turns run, by task kind finished */
  counters = { turns: 0, byTask: new Float64Array(64) };
  /** traffic changed the road field since it was last published (transient) */
  roadDirty = false;
  /** the content this state was built against (fire hooks get only the planet) */
  contentRef: Content | null = null;

  constructor(cells: number, kw: number, cap = 64) {
    this.agents = new AgentStore(cap, kw);
    this.wheel = new TimeWheel(1024, 0);
    this.buckets = new CellBuckets(cells, 0);
  }

  toJson(): PeopleJson {
    return {
      agents: this.agents.toJson(),
      buildings: JSON.parse(JSON.stringify(this.buildings)) as Building[],
      settlements: JSON.parse(JSON.stringify(this.settlements)) as Settlement[],
      herds: JSON.parse(JSON.stringify(this.herds)) as Herd[],
      items: JSON.parse(JSON.stringify(this.items)) as GroundItem[],
      names: { ...this.names },
      version: 0,
      herdClock: this.herdClock,
      missions: JSON.parse(JSON.stringify(this.missions)) as Mission[],
      polities: JSON.parse(JSON.stringify(this.polities)) as Polity[],
      relations: JSON.parse(JSON.stringify(this.relations)) as Relation[],
      routes: JSON.parse(JSON.stringify(this.routes)) as Record<string, Route>,
      species: JSON.parse(JSON.stringify(this.species)) as DerivedAnimal[],
      eco: JSON.parse(JSON.stringify(this.eco)) as EcoState,
      blight: this.blight.slice(),
      worship: this.worship.slice(),
      firsts: { ...this.firsts },
      pending: this.pending.map((r) => ({ ...r })),
    };
  }

  static fromJson(j: PeopleJson | undefined, cells: number, content: Content | null): PeopleState {
    const kw = content ? recipeTable(content).kw : 8;
    if (!j) return new PeopleState(cells, kw);
    const ps = new PeopleState(cells, j.agents?.kw ?? kw, 8);
    if (j.agents) ps.agents = AgentStore.fromJson(j.agents);
    ps.buildings = (j.buildings ?? []).map((b) => ({ ...b, pos: [...b.pos] as [number, number, number], books: [...b.books] }));
    ps.settlements = JSON.parse(JSON.stringify(j.settlements ?? [])) as Settlement[];
    ps.herds = JSON.parse(JSON.stringify(j.herds ?? [])) as Herd[];
    ps.items = JSON.parse(JSON.stringify(j.items ?? [])) as GroundItem[];
    ps.names = { ...(j.names ?? {}) };
    ps.herdClock = j.herdClock ?? 0;
    ps.missions = JSON.parse(JSON.stringify(j.missions ?? [])) as Mission[];
    ps.polities = JSON.parse(JSON.stringify(j.polities ?? [])) as Polity[];
    ps.relations = JSON.parse(JSON.stringify(j.relations ?? [])) as Relation[];
    ps.routes = JSON.parse(JSON.stringify(j.routes ?? {})) as Record<string, Route>;
    ps.species = JSON.parse(JSON.stringify(j.species ?? [])) as DerivedAnimal[];
    ps.eco = { immigration: true, seen: {}, extinct: {}, peak: {}, ...(JSON.parse(JSON.stringify(j.eco ?? {})) as Partial<EcoState>) };
    ps.blight = (j.blight ?? []).slice();
    ps.worship = (j.worship ?? [0, 0, 0, 0]).slice();
    ps.firsts = { ...(j.firsts ?? {}) };
    ps.pending = (j.pending ?? []).map((r) => ({ ...r }));
    for (const st of ps.settlements) normaliseSettlement(st);
    return ps;
  }

  /** rebuild every transient index from the saved state (after load, or after the arrays were filled) */
  reindex(now: number): void {
    const A = this.agents;
    A.reindex();
    this.wheel = new TimeWheel(1024, now);
    for (let s = 0; s < A.hi; s++) if (A.alive[s]) this.wheel.schedule(A.id[s], Math.max(now, A.next[s]));
    this.buckets.ensure(A.cap);
    this.buckets.clear();
    for (let s = 0; s < A.hi; s++) if (A.alive[s]) this.buckets.move(s, A.cell[s]);
    this.reindexBuildings();
    this.iByCell.clear();
    for (const it of this.items) this.iByCell.add(it.cell, it.id);
    this.sIndex.clear();
    this.settlements.forEach((st, i) => this.sIndex.set(st.id, i));
    this.rebuildMembers();
    this.hIndex.clear();
    this.herds.forEach((h, i) => this.hIndex.set(h.id, i));
    this.sunTick = -1;
    this.sunRateHour = -1;
    this.now = now;
  }

  mission(id: number): Mission | undefined {
    for (const m of this.missions) if (m.id === id) return m;
    return undefined;
  }

  polity(id: number): Polity | undefined {
    for (const pl of this.polities) if (pl.id === id) return pl;
    return undefined;
  }

  /** the relation between two polities (undefined if they never met) */
  relation(a: number, b: number): Relation | undefined {
    if (a === b) return undefined;
    const lo = a < b ? a : b, hi = a < b ? b : a;
    for (const r of this.relations) if (r.a === lo && r.b === hi) return r;
    return undefined;
  }

  reindexBuildings(): void {
    this.bIndex.clear();
    this.bByCell.clear();
    this.buildings.forEach((b, i) => {
      this.bIndex.set(b.id, i);
      this.bByCell.add(b.cell, b.id);
    });
  }

  rebuildMembers(): void {
    this.members.clear();
    for (const st of this.settlements) this.members.set(st.id, []);
    const A = this.agents;
    // ascending slot order, then sorted by id: identical whether built now or after a load
    for (let s = 0; s < A.hi; s++) {
      if (!A.alive[s]) continue;
      const l = this.members.get(A.settlement[s]);
      if (l) l.push(s);
    }
    for (const l of this.members.values()) l.sort((a, b) => A.id[a] - A.id[b]);
  }

  addMember(settlement: number, slot: number): void {
    let l = this.members.get(settlement);
    if (!l) this.members.set(settlement, (l = []));
    const id = this.agents.id[slot];
    let i = l.length;
    while (i > 0 && this.agents.id[l[i - 1]] > id) i--;
    l.splice(i, 0, slot);
  }

  removeMember(settlement: number, slot: number): void {
    const l = this.members.get(settlement);
    if (!l) return;
    const i = l.indexOf(slot);
    if (i >= 0) l.splice(i, 1);
  }

  /** living slots in a cell, ascending agent id (canonical order) */
  agentsIn(cell: number, out: number[] = []): number[] {
    const id = this.agents.id;
    return this.buckets.list(cell, (s) => id[s], out);
  }

  private bsCache = new Map<number, Building[]>();
  private bsVer = -1;

  /** the buildings of a settlement, in `buildings` order (cached until the building list changes) */
  of(settlement: number): readonly Building[] {
    if (this.bsVer !== this.version) {
      this.bsCache.clear();
      for (const b of this.buildings) {
        let l = this.bsCache.get(b.settlement);
        if (!l) this.bsCache.set(b.settlement, (l = []));
        l.push(b);
      }
      this.bsVer = this.version;
    }
    return this.bsCache.get(settlement) ?? NO_BUILDINGS;
  }

  building(id: number): Building | undefined {
    const i = this.bIndex.get(id);
    return i === undefined ? undefined : this.buildings[i];
  }

  settlement(id: number): Settlement | undefined {
    const i = this.sIndex.get(id);
    return i === undefined ? undefined : this.settlements[i];
  }

  herd(id: number): Herd | undefined {
    const i = this.hIndex.get(id);
    return i === undefined ? undefined : this.herds[i];
  }

  addBuilding(b: Building): void {
    this.buildings.push(b);
    this.bIndex.set(b.id, this.buildings.length - 1);
    this.bByCell.add(b.cell, b.id);
    this.version++;
  }

  addSettlement(st: Settlement): void {
    normaliseSettlement(st);
    this.settlements.push(st);
    this.sIndex.set(st.id, this.settlements.length - 1);
    if (!this.members.has(st.id)) this.members.set(st.id, []);
    this.version++;
  }
}
