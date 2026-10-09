// GENESIS — the state of worlds-and-space (CONTRACT.md §6.4, §12): every ship (being built at its pad, fuelled, crewed,
// in flight, landed, lost), what each people has seen of the other worlds through its instruments, the firsts of the
// system (first launch, first landing on another world, first contact between worlds, first abandoned world), the
// relations between peoples of different worlds, the colonies founded across space, and the god's pushes waiting.
//
// Plain JSON only: saved in the save header (`space`), hashed, restored by rewind, iterated in array / sorted-key order.
// The people aboard a ship are not agents of any world while they fly: each is a CrewMember record carrying all that
// makes them who they are (knowledge, skills, traits, faith, sickness, kin, what they wear), and becomes an agent again
// where the ship comes down.

export type V3 = [number, number, number];

/**
 * A ship's life: 'building' (its people make the hull at the pad) -> 'fuelling' (fuel and goods loaded) -> 'boarding'
 * (the crew walk to the pad) -> 'pad' (countdown) -> 'ascent' -> 'orbit' -> 'transfer' -> 'descent' -> 'landed'; a
 * flight that fails ends 'lost'; one whose world was erased under it drifts 'stranded'; 'done' ships are dropped.
 */
export type ShipPhase =
  | 'building' | 'fuelling' | 'boarding' | 'pad' | 'ascent' | 'orbit' | 'transfer' | 'descent' | 'landed' | 'lost' | 'stranded' | 'done';

/** why a people leaves (the chronicle's words come from it) */
export type Purpose = 'colony' | 'exodus' | 'refuge' | 'trade' | 'curiosity' | 'god' | 'survey' | 'return';

/** a person aboard a ship (an agent lifted out of its world: everything needed to set them down again) */
export interface CrewMember {
  id: number;
  species: number;
  flags: number;
  caste: number;
  /** birth tick (ages are kept through the flight) */
  birth: number;
  name: number;
  /** a name the god gave them (people/state names) */
  custom: string;
  traits: number[];
  skills: number[];
  needs: number[];
  health: number;
  /** recipe indices known */
  know: number[];
  /** disease index (-1 well), the tick it turns infectious, the tick it ends; immunity bits */
  disease: number;
  infectT: number;
  sickEnd: number;
  immune: number;
  /** faith: love and fear per god (0 the player, 1.. rivals or visitors) */
  love: number[];
  fear: number[];
  mother: number;
  father: number;
  partner: number;
  /** worn clothing (a pressure suit) and the tool in hand: item indices, -1 none */
  gear: number;
  tool: number;
  role: number;
  /** memories (kind, tick, a) of the last few notable things */
  mem: [number, number, number][];
}

export interface ShipState {
  id: number;
  /** ship kind id (ships.json) */
  kind: string;
  name: string;
  /** home settlement (on `home`), its name for the chronicle once it is gone */
  owner: number;
  ownerName: string;
  home: number;
  species: number;
  purpose: Purpose;
  /** the reason in words ("their world is dying", "they have outgrown their land") */
  why: string;
  phase: ShipPhase;
  /** when the current phase began / is due to end (-1 open) */
  t0: number;
  t1: number;
  created: number;
  /** the world it leaves from now and the world it is bound for (-1 not chosen) */
  from: number;
  to: number;
  /** the pad: body-frame unit vector and cell on `from`, its building id (-1 none) */
  padPos: V3;
  padCell: number;
  padBuilding: number;
  /** where it comes down: body-frame unit vector and cell on `to`, the settlement there it seeks (-1 none) */
  dest: V3;
  destCell: number;
  destSettlement: number;
  /** cruise / orbit altitude (m) and the orbit's great circle in the equatorial frame of `from` */
  altitude: number;
  orbitA: V3;
  orbitB: V3;
  orbitPeriod: number;
  /** transfer: system-frame cubic Bezier control points (metres) */
  bez: V3[];
  launchTick: number;
  arriveTick: number;
  /** preparation progress 0..1 (fuelling and loading) */
  work: number;
  /** the hull taken from the store (item index, -1 none / a gate) */
  hull: number;
  /** fuel aboard for the way home (item index, qty) */
  fuelBack: [number, number][];
  /**
   * goods set aside for this ship at its pad (item index, qty): the hull's parts until it is made, the fuel of the
   * flight (both ways for a voyage home). Taken out of the store as they come in, so the town's own builders and
   * crafters cannot spend them; back into the store if the program is given up.
   */
  stock: [number, number][];
  /** the last tick the program got anywhere (pad raised, parts set aside, hull worked, fuel loaded) and how far */
  markAt: number;
  mark: number;
  /** sicknesses its people live with at home, carried unseen by the crew (latent carriers: disease indices) */
  carried: number[];
  /** body-frame direction the descent starts from (on `to`): a ship turned back from orbit comes down from there */
  descFrom: V3 | null;
  /** crew agent ids chosen (before they board) and the ground crew working at the pad */
  crewIds: number[];
  ground: number[];
  /** the people aboard (after boarding) */
  crew: CrewMember[];
  /** goods aboard (item index, qty) and food in person-days */
  cargo: [number, number][];
  food: number;
  /** chance this flight goes well (crew skill, the weather, the star) */
  reliability: number;
  /** what went wrong (lost / stranded) */
  cause: string;
  /** the phase it was lost in, and where (on / near a world: body frame + altitude; between worlds: system metres) */
  lostIn: string;
  lostAt: { planet: number; pos: V3; alt: number; sys: V3 } | null;
  /** on the way home from a visit */
  returning: boolean;
  /** worlds it has stood on */
  visits: number[];
  /** the outcome at its destination ('colony', 'trade', 'war', 'merger', 'worship', 'silence', 'return', ...) */
  outcome: string;
  /** deaths and births aboard */
  dead: number;
  born: number;
  /** last transit day reckoned (food, sickness, storms) */
  lastDay: number;
  /** short history for the inspector */
  log: string[];
  /** the era of its people when it was laid down (contact reads the gap between two peoples) */
  era: number;
}

/** what one people knows of another world from watching the sky: 1 a wandering light, 2 its seas, air and green, 3 its peoples */
export type ObsLevel = 0 | 1 | 2 | 3;

/** two peoples of different worlds who have met */
export interface WorldRelation {
  /** "<planet>:<settlement>" of each side (a < b as strings) */
  a: string;
  b: string;
  /** opinions both ways (-1 .. 1) */
  op: [number, number];
  contact: number;
  trade: number;
  war: number;
  /** the first meeting's outcome */
  outcome: string;
}

export interface ColonyRecord {
  planet: number;
  settlement: number;
  /** where its people came from */
  from: number;
  parent: number;
  ship: number;
  tick: number;
}

/** the god's push: a settlement is told to go (to a world, for a reason, in a kind of ship) */
export interface SpaceOrder {
  planet: number;
  settlement: number;
  to: number;
  purpose: Purpose;
  kind: string;
  tick: number;
}

export interface SpaceJson {
  ships: ShipState[];
  observed: Record<string, Record<string, number>>;
  cooldown: Record<string, number>;
  firsts: Record<string, number>;
  relations: WorldRelation[];
  colonies: ColonyRecord[];
  orders: SpaceOrder[];
  /** settlement key -> what drove it last time it was judged (inspector) */
  motives: Record<string, Record<string, number>>;
}

export class SpaceState {
  ships: ShipState[] = [];
  /** "<planet>:<settlement>" -> planet id -> observation level */
  observed: Record<string, Record<string, number>> = {};
  /** "<planet>:<settlement>" -> no new program before this tick */
  cooldown: Record<string, number> = {};
  /** system firsts: 'launch', 'orbit', 'landing', 'contact', 'abandoned', 'colony', 'gate' -> tick */
  firsts: Record<string, number> = {};
  relations: WorldRelation[] = [];
  colonies: ColonyRecord[] = [];
  orders: SpaceOrder[] = [];
  motives: Record<string, Record<string, number>> = {};

  toJson(): SpaceJson {
    return JSON.parse(JSON.stringify({
      ships: this.ships, observed: sortDeep(this.observed), cooldown: sortKeys(this.cooldown), firsts: sortKeys(this.firsts),
      relations: this.relations, colonies: this.colonies, orders: this.orders, motives: sortDeep(this.motives),
    })) as SpaceJson;
  }

  static fromJson(j: Partial<SpaceJson> | undefined | null): SpaceState {
    const s = new SpaceState();
    if (!j) return s;
    const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    // (a phase-4 round-1 save has no set-aside stock, progress mark, latent sicknesses or descent start)
    s.ships = copy(j.ships ?? []).map((sh) => ({ ...sh, stock: sh.stock ?? [], markAt: sh.markAt ?? sh.t0, mark: sh.mark ?? 0, carried: sh.carried ?? [], descFrom: sh.descFrom ?? null }));
    s.observed = copy(j.observed ?? {});
    s.cooldown = { ...(j.cooldown ?? {}) };
    s.firsts = { ...(j.firsts ?? {}) };
    s.relations = copy(j.relations ?? []);
    s.colonies = copy(j.colonies ?? []);
    s.orders = copy(j.orders ?? []);
    s.motives = copy(j.motives ?? {});
    return s;
  }

  ship(id: number): ShipState | undefined {
    for (const sh of this.ships) if (sh.id === id) return sh;
    return undefined;
  }

  /** the relation between two peoples of different worlds (undefined if they never met) */
  relation(a: string, b: string): WorldRelation | undefined {
    const lo = a < b ? a : b, hi = a < b ? b : a;
    for (const r of this.relations) if (r.a === lo && r.b === hi) return r;
    return undefined;
  }
}

/** the key of a settlement across the system */
export function stKey(planet: number, settlement: number): string {
  return `${planet}:${settlement}`;
}

function sortKeys<T>(o: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function sortDeep<T>(o: Record<string, Record<string, T>>): Record<string, Record<string, T>> {
  const out: Record<string, Record<string, T>> = {};
  for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
  return out;
}
