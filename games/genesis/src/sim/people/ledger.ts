// GENESIS — LIVING LAND (LIVING.md §2.12): the ledger of how a settlement lives off the land, and LAND's saved state.
//
// Per settlement per game year (the planet's year: tick / year, from 0) the sim keeps its own books — kills by species,
// hunting trips, injuries and hunters lost, tames, what the herds gave, sowings and harvests by crop, fishing sessions
// and catch by source (a shoal, a river or lake's own stock, nothing), food brought in by source (in food-days: items.json
// `food` × units), what was gathered and crafted, births, deaths by cause and age band, the spacing of a mother's births,
// festivals, weddings and funerals, and at the year's end its houses, beds and people. The probes read these books
// (query 'ledger') instead of patching the sim in memory, and the settlement card shows this year's food by source
// (SettlementView.livelihood).
//
// LAND's state lives on the settlement (`Settlement.land`: the ledger, the hunting party, the fields on their seasonal
// clock, the gatherings, its firsts) and on the world (`PeopleState.land`: the fish stocks of its waters). Both are made
// the first time they are touched and saved as JSON with the rest of the peoples state (hashed with it).

import type { PCtx } from './ctx.ts';
import type { Settlement, PeopleState } from './state.ts';
import { AgentFlag, BuildingFlag } from '../types.ts';
import { CURIO, NEED_N, STATUS } from './needs.ts';

/** years of books a settlement keeps (older years are dropped: a 230-year world keeps its last 40) */
export const LEDGER_YEARS = 40;
/** birth intervals kept per year row (the probe's median needs a sample, not all of them) */
const INTERVALS_MAX = 64;

export type FoodSource = 'forage' | 'hunt' | 'fish' | 'farm' | 'herd';
export const FOOD_SOURCES: readonly FoodSource[] = ['forage', 'hunt', 'fish', 'farm', 'herd'];

/** one settlement-year of the books */
export interface LedgerYear {
  /** the planet's year index (tick / year, from 0) */
  year: number;
  /** wild animals killed by hunters, by species id */
  kills: Record<string, number>;
  /** hunting parties that set out, hunters hurt by their prey, hunters killed by it */
  huntTrips: number;
  huntInjuries: number;
  huntDeaths: number;
  /** first herds tamed (from the wild, or young brought home from a hunt), by species id of the domestic form */
  tames: Record<string, number>;
  /** what the herds gave (milk, wool, eggs, honey; meat and hides of the slaughtered), by item id */
  herdProducts: Record<string, number>;
  /** head slaughtered, by species id */
  slaughter: Record<string, number>;
  /** fields sown and harvested by crop id, the units harvested by item id, fields lost unharvested */
  sowings: Record<string, number>;
  harvests: Record<string, number>;
  harvestUnits: Record<string, number>;
  spoiled: number;
  /** fishing sessions and their catch (units) by where the fish came from */
  fishing: { shoal: number; stock: number; none: number };
  catch: { shoal: number; stock: number; none: number };
  /** food brought in (food-days), by source */
  food: Record<FoodSource, number>;
  /** gathered from the land (units), by item id */
  gathered: Record<string, number>;
  /** crafts made (runs), by recipe id */
  crafts: Record<string, number>;
  births: number;
  /** deaths by cause name (defs.ts DEATH_NAMES), and those of infants (< 1 year) and children (< 15) */
  deaths: Record<string, number>;
  deathsInfant: number;
  deathsChild: number;
  /** years between a mother's births (a sample: the first INTERVALS_MAX) */
  intervals: number[];
  /** gatherings held, and the share of the people that came to the festivals (summed over festivals) */
  festivals: number;
  festivalAttend: number;
  weddings: number;
  funerals: number;
  /** couples formed and deaths at home this year (what weddings and funerals are counted against) */
  couples: number;
  homeDeaths: number;
  /** at the last daily update: people (with the cohort), the share under 15, dwellings, beds, households, housed */
  pop: number;
  u15: number;
  houses: number;
  beds: number;
  households: number;
  housed: number;
  /** adults whose status / curiosity need sat below 0.02, as a share of adults (last daily update) */
  statusLow: number;
  curioLow: number;
}

/** a hunting party out after a herd (people/hunt.ts) */
export interface HuntParty {
  /** party id (the tick it formed) */
  id: number;
  /** agent ids, the leader first */
  members: number[];
  /** the herd it tracks */
  herd: number;
  /** the species it went out for (the herd may be gone) */
  species: number;
  /** the tick it set out, the tick of its last encounter (one encounter for the party at a time) */
  since: number;
  lastTry: number;
  /** head killed so far on this trip */
  kills: number;
}

/** a crop field on the seasonal clock (people/crops.ts) */
export interface FieldState {
  /** the cell */
  c: number;
  /** plant index of the crop sown (-1: fallow, waiting for the sowing season) */
  sp: number;
  /** the tick it was sown */
  sown: number;
  /** growth 0..1 (1 = ripe), integrated hour by hour from its suitability */
  prog: number;
  /** what is left of the crop after grazing, blight, fire, flood, rot (0..1) */
  q: number;
  /** the tick growth was last integrated */
  t: number;
  /** the tick it ripened (-1 not yet) */
  ripe: number;
  /** the crop cover the field showed after the last update (grazing and blight are read off what it lost since) */
  shown: number;
}

/** a gathering of the settlement (people/gatherings.ts) */
export interface Gathering {
  /** 'harvest' | 'midwinter' | 'rains' (festivals), 'wedding', 'funeral' */
  kind: string;
  /** when it begins and ends (ticks) */
  from: number;
  until: number;
  /** where: a cell and a point */
  cell: number;
  pos: [number, number, number];
  /** the people it is about (the couple, the dead), agent ids */
  about: number[];
  /** agent ids who came */
  came: number[];
  /** their kin, called first (the dead's partner, parents and household; the couple's parents), agent ids ascending */
  kin?: number[];
}

/** LAND's state of one settlement (Settlement.land) */
export interface LandState {
  ledger: LedgerYear[];
  party: HuntParty | null;
  fields: FieldState[];
  gatherings: Gathering[];
  /** the year index of the last festival of each kind ('harvest', 'winter') */
  fest: Record<string, number>;
  /** firsts of this settlement ('great-hunt', 'herd', 'milk', 'harvest:<crop>' ...) -> tick */
  firsts: Record<string, number>;
  /** per owned herd id: the tick its milk / wool / eggs were last taken (people/herding.ts) */
  milked: Record<string, number>;
  /** the year index of the last gathering told in the chronicle (one line a settlement-year) */
  told: number;
}

/** a fish stock of one water body (people/fishing.ts) */
export interface FishStock {
  /** carrying capacity and stock (units of fish) */
  K: number;
  S: number;
  /** the tick the stock was last brought up to date */
  t: number;
  /** cells in the water body when it was first fished (its size) */
  n: number;
  /** the tick the chronicle said the fish had left (-1 never) */
  gone: number;
}

/** LAND's state of one world (PeopleState.land) */
export interface LandWorld {
  /** water body id (its lowest cell) -> its stock */
  stocks: Record<string, FishStock>;
  /** a fished cell -> the water body it was found to belong to (kept: a lake that shrinks keeps its stock) */
  body: Record<string, number>;
}

/** LAND's state of a settlement (made the first time it is touched) */
export function landOf(st: Settlement): LandState {
  let l = st.land;
  if (!l) {
    l = { ledger: [], party: null, fields: [], gatherings: [], fest: {}, firsts: {}, milked: {}, told: -1 };
    st.land = l;
  }
  return l;
}

/** LAND's state of a world (made the first time it is touched) */
export function landWorld(ps: PeopleState): LandWorld {
  if (!ps.land) ps.land = { stocks: {}, body: {} };
  return ps.land;
}

function newYear(year: number): LedgerYear {
  return {
    year, kills: {}, huntTrips: 0, huntInjuries: 0, huntDeaths: 0, tames: {}, herdProducts: {}, slaughter: {},
    sowings: {}, harvests: {}, harvestUnits: {}, spoiled: 0, fishing: { shoal: 0, stock: 0, none: 0 }, catch: { shoal: 0, stock: 0, none: 0 },
    food: { forage: 0, hunt: 0, fish: 0, farm: 0, herd: 0 }, gathered: {}, crafts: {}, births: 0, deaths: {}, deathsInfant: 0,
    deathsChild: 0, intervals: [], festivals: 0, festivalAttend: 0, weddings: 0, funerals: 0, couples: 0, homeDeaths: 0,
    pop: 0, u15: 0, houses: 0, beds: 0, households: 0, housed: 0, statusLow: 0, curioLow: 0,
  };
}

/** the year index of tick t on this planet */
export function yearOf(x: PCtx, t = x.tick): number {
  return Math.floor(t / x.year);
}

/** this year's row of a settlement's books (made when the year's first entry comes in) */
export function ledger(x: PCtx, st: Settlement): LedgerYear {
  const l = landOf(st).ledger;
  const y = yearOf(x);
  // the rows stay in year order: a time-lapse window replays agents in the past (perf/plapse.ts moves x.tick back), so
  // near a year's end entries for the old year and the new one alternate — each must find its own row
  let i = l.length - 1;
  while (i >= 0 && l[i].year > y) i--;
  if (i >= 0 && l[i].year === y) return l[i];
  const row = newYear(y);
  l.splice(i + 1, 0, row);
  if (l.length > LEDGER_YEARS) l.splice(0, l.length - LEDGER_YEARS);
  return row;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** add to a counter of a record */
export function bump(o: Record<string, number>, k: string, v = 1): void {
  o[k] = r3((o[k] ?? 0) + v);
}

/** food brought in from source `src`: `units` of item index `it` (food-days by items.json `food`) */
export function addFood(x: PCtx, st: Settlement, src: FoodSource, it: number, units: number): void {
  if (units <= 0 || it < 0) return;
  const f = x.c.items.list[it]?.food ?? 0;
  if (f <= 0) return;
  const row = ledger(x, st);
  row.food[src] = r3(row.food[src] + units * f);
}

/** something gathered from the land (work.ts gather) */
export function noteGathered(x: PCtx, st: Settlement, it: number, units: number, food: boolean): void {
  if (units <= 0 || it < 0) return;
  bump(ledger(x, st).gathered, x.c.items.list[it]?.id ?? String(it), units);
  if (food) addFood(x, st, 'forage', it, units);
}

/** a craft made (work.ts, the craft task) */
export function noteCraft(x: PCtx, st: Settlement, k: number): void {
  bump(ledger(x, st).crafts, x.rt.list[k]?.id ?? String(k));
}

/** a birth (lifecycle.ts birth): the interval since the mother's last one, in years (null: her first recorded) */
export function noteBirth(x: PCtx, st: Settlement, interval: number | null): void {
  const row = ledger(x, st);
  row.births++;
  if (interval !== null && row.intervals.length < INTERVALS_MAX) row.intervals.push(Math.round(interval * 100) / 100);
}

/** a death (lifecycle.ts die): its cause name, the age in years, and whether it was at home (a funeral is owed) */
export function noteDeath(x: PCtx, st: Settlement, cause: string, age: number, home: boolean): void {
  const row = ledger(x, st);
  bump(row.deaths, cause);
  if (age < 1) row.deathsInfant++;
  if (age < 15) row.deathsChild++;
  if (home) row.homeDeaths++;
}

/** the daily census of the books: people, the young, houses and beds, households housed, needs met */
export function ledgerDaily(x: PCtx, st: Settlement): void {
  const row = ledger(x, st);
  const A = x.A;
  const members = x.ps.members.get(st.id) ?? [];
  let u15 = 0, adults = 0, statusLow = 0, curioLow = 0;
  for (const m of members) {
    if ((x.tick - A.birth[m]) / x.year < 15) u15++;
    if (A.flags[m] & AgentFlag.child) continue;
    adults++;
    if (A.needs[m * NEED_N + STATUS] < 0.02) statusLow++;
    if (A.needs[m * NEED_N + CURIO] < 0.02) curioLow++;
  }
  const cohort = st.cohort.n[0] + st.cohort.n[1] + st.cohort.n[2];
  row.pop = Math.round(members.length + cohort);
  row.u15 = r3((u15 + st.cohort.n[0]) / Math.max(1, members.length + cohort));
  row.statusLow = adults ? r3(statusLow / adults) : 0;
  row.curioLow = adults ? r3(curioLow / adults) : 0;
  let houses = 0, beds = 0;
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1 || b.flags & BuildingFlag.ruined) continue;
    const def = x.c.buildings.list[b.type];
    if (def.function !== 'shelter') continue;
    houses++;
    beds += def.capacity;
  }
  row.houses = houses;
  row.beds = beds;
  row.households = st.households.length;
  row.housed = st.households.filter((h) => h.home >= 0).length;
}

/** this year's food by source as shares (SettlementView.livelihood), the livestock kept and the share under 15 */
export function livelihoodOf(x: PCtx, st: Settlement): { food: Record<FoodSource, number>; herds: number; under15: number } | undefined {
  const l = st.land;
  if (!l || !l.ledger.length) return undefined;
  const y = yearOf(x);
  // this year's books, or last year's in the first days of a year (an empty card at each new year reads as a famine)
  let row = l.ledger[l.ledger.length - 1];
  const prev = l.ledger.length > 1 ? l.ledger[l.ledger.length - 2] : undefined;
  const tot = (r: LedgerYear) => FOOD_SOURCES.reduce((a, k) => a + r.food[k], 0);
  if (prev && prev.year === y - 1 && row.year === y && tot(row) < tot(prev) * 0.15) row = prev;
  const t = tot(row);
  const food = { forage: 0, hunt: 0, fish: 0, farm: 0, herd: 0 } as Record<FoodSource, number>;
  if (t > 0) for (const k of FOOD_SOURCES) food[k] = r3(row.food[k] / t);
  let herds = 0;
  for (const h of x.ps.herds) if (h.owner === st.id) herds += h.count;
  return { food, herds: Math.round(herds), under15: l.ledger[l.ledger.length - 1].u15 };
}

/**
 * query('ledger', { settlement?, year? }): the books of one settlement (or of every settlement on the planet, fallen ones
 * too), all the years it kept or only `year` (the planet's year index, from 0). Each entry: { settlement, name, fallen,
 * years: LedgerYear[] }.
 */
export function ledgerQuery(x: PCtx, args: Record<string, unknown>): unknown {
  const sid = typeof args.settlement === 'number' ? args.settlement : undefined;
  const year = typeof args.year === 'number' ? Math.floor(args.year) : undefined;
  const out: { settlement: number; name: string; fallen: boolean; years: LedgerYear[] }[] = [];
  for (const st of x.ps.settlements) {
    if (sid !== undefined && st.id !== sid) continue;
    const rows = (st.land?.ledger ?? []).filter((r) => year === undefined || r.year === year);
    out.push({ settlement: st.id, name: st.name, fallen: st.fallen >= 0, years: JSON.parse(JSON.stringify(rows)) as LedgerYear[] });
  }
  return { year: yearOf(x), yearTicks: x.year, settlements: out };
}
